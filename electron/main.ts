import { app, BrowserWindow, ipcMain, dialog, shell, Menu, session as electronSession } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { TelnetSession } from './telnet';
import { loadWorlds, saveWorlds, newWorld, importMcl, type World } from './worlds';
import { importMclTriggers, importMclAliases, importMclTimers } from './mcl';
import { expandLogName } from '../shared/logname';
import { LOG_HTML_HEAD } from '../src/lib/loghtml';
import { aboutInfo, checkForUpdates, downloadUpdate, installUpdate } from './updates';
import type { ReleaseAsset, UpdateFlavour } from '../shared/updates';
import { PuebloFilter } from '../shared/pueblo';
import { MxpFilter } from '../shared/mxp';

interface Session {
  id: string;
  world: World;
  telnet: TelnetSession;
  mxp: MxpFilter;
  pueblo: PuebloFilter;
  log: fs.WriteStream | null;
  logHtml: boolean;
  logRaw: boolean;
}

// Smoke runs use a throwaway profile so they never touch the real world list or logs. Each run gets
// its own folder (by pid): a previous run's GPU or crash-handler child can still hold files open for a
// moment, and a failed delete here would stop the window ever opening. Old folders are swept best-effort.
if (process.env.LANTERN_SMOKE) {
  const smokeRoot = path.join(app.getPath('temp'), 'lantern-smoke');
  try {
    for (const old of fs.existsSync(smokeRoot) ? fs.readdirSync(smokeRoot) : []) {
      try { fs.rmSync(path.join(smokeRoot, old), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch { /* still in use: leave it */ }
    }
  } catch { /* nothing to sweep */ }
  app.setPath('userData', path.join(smokeRoot, String(process.pid)));
}

const sessions = new Map<string, Session>();
let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Lantern',
    backgroundColor: '#14120f',
    autoHideMenuBar: true,
    // Smoke runs must not steal focus from whatever the user is doing.
    show: !process.env.LANTERN_SMOKE,
    focusable: !process.env.LANTERN_SMOKE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Let the Settings dialog list installed fonts (Local Font Access API); everything else keeps Electron's default.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  electronSession.defaultSession.setPermissionCheckHandler(() => true);
  if (process.env.LANTERN_SMOKE) win.once('ready-to-show', () => win?.showInactive());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Apply the saved spell-check languages, if any.
  try {
    const sp = (readSettings()?.spellLanguages as string[]) ?? ['en-AU'];
    applySpellLanguages(sp);
  } catch { /* defaults are fine */ }

  // Right-click: spelling suggestions, add-to-dictionary, and the usual edit items.
  win.webContents.on('context-menu', (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 6)) {
        items.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) });
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No suggestions', enabled: false });
      items.push({ type: 'separator' });
      items.push({ label: 'Add to dictionary', click: () => win?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable || params.selectionText) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win! });
  });

  win.on('closed', () => { win = null; });

  // Smoke test: LANTERN_SMOKE=host:port:out.png connects, waits, screenshots the window, quits.
  const smoke = process.env.LANTERN_SMOKE;
  if (smoke) {
    const [host, port, out] = smoke.split('|');
    win.webContents.on('did-finish-load', () => {
      // LANTERN_SMOKE_AUTO="y\nlook" gives the smoke world "Send on connect" lines (\n separates them).
      const auto = process.env.LANTERN_SMOKE_AUTO?.replace(/\\n/g, '\n');
      setTimeout(() => send('smoke:run', { host, port: Number(port), panel: process.env.LANTERN_SMOKE_PANEL, view: process.env.LANTERN_SMOKE_VIEW, auto }), 500);
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        fs.writeFileSync(out, img.toPNG());
        app.quit();
      }, Number(process.env.LANTERN_SMOKE_WAIT ?? 7000));
    });
  }
}

const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};

/* ---------- logging ---------- */

function logsDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function openLog(world: World): fs.WriteStream | null {
  if (!world.logging) return null;
  const html = world.log.format === 'html';
  let file = expandLogName(world.log.file, world.name, world.log.format);
  if (!path.isAbsolute(file)) file = path.join(logsDir(), file);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fresh = !fs.existsSync(file) || fs.statSync(file).size === 0;
    const stream = fs.createWriteStream(file, { flags: 'a' });
    if (html && fresh) stream.write(LOG_HTML_HEAD + '\n');
    if (world.log.worldNameHeader) {
      // One clean log per day: a full header the first time the day's file is opened, then a slim
      // "reconnected" marker on later connections that append to the same file.
      if (fresh) {
        const header = `${world.name} — ${new Date().toLocaleString()}`;
        stream.write(html ? `<p class="hdr">${header.replace(/</g, '&lt;')}</p>\n` : `\n===== ${header} =====\n`);
      } else {
        const mark = `reconnected ${new Date().toLocaleTimeString()}`;
        stream.write(html ? `<p class="hdr reconnect">— ${mark} —</p>\n` : `\n--- ${mark} ---\n`);
      }
    }
    return stream;
  } catch (e) {
    console.error('log open failed', file, e);
    return null;
  }
}

/**
 * The renderer logs line by line (store.ts) once it knows what each finished line is: game text,
 * a typed command, a gagged line, or a line captured by a channel tab (prefixed with the tab name).
 */
function logLine(s: Session, text: string, html?: string) {
  if (!s.log) return;
  s.log.write((s.logHtml && html !== undefined ? html : String(text).replace(/\r/g, '')) + '\n');
}

/* ---------- IPC: worlds ---------- */

ipcMain.handle('worlds:list', () => loadWorlds());
ipcMain.handle('worlds:save', (_e, worlds: World[]) => {
  saveWorlds(worlds);
  const saved = loadWorlds();
  // Apply logging changes to any live session at once, so a format change (e.g. Raw) takes
  // effect without reconnecting. The log stream and its format are reopened if they differ.
  for (const s of sessions.values()) {
    const w = saved.find((x) => x.id === s.world.id);
    if (!w) continue;
    const changed = JSON.stringify(w.log) !== JSON.stringify(s.world.log) || w.logging !== s.world.logging;
    s.world = w;
    if (changed) {
      if (s.log) { const old = s.log; s.log = null; old.end(); }
      s.log = openLog(w);
      s.logHtml = w.log.format === 'html';
      s.logRaw = w.logging && w.log.format === 'raw';
    }
  }
  return saved;
});
ipcMain.handle('worlds:create', (_e, partial?: Partial<World>) => {
  const worlds = loadWorlds();
  const w = newWorld(partial);
  worlds.push(w);
  saveWorlds(worlds);
  return w;
});
ipcMain.handle('worlds:importMcl', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Import MUSHclient world files',
    filters: [{ name: 'MUSHclient worlds', extensions: ['mcl', 'MCL'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled) return [];
  const worlds = loadWorlds();
  const added: World[] = [];
  for (const file of res.filePaths) {
    const xml = fs.readFileSync(file, 'latin1');
    const w = newWorld({ name: path.basename(file, path.extname(file)), ...importMcl(xml) });
    worlds.push(w);
    added.push(w);
  }
  saveWorlds(worlds);
  return added;
});

/* ---------- IPC: MUSHclient trigger/alias/timer XML (exports, clipboard copies, plugins) ---------- */

function parseMclXml(xml: string) {
  return { triggers: importMclTriggers(xml), aliases: importMclAliases(xml), timers: importMclTimers(xml) };
}
ipcMain.handle('mcl:parse', (_e, xml: string) => parseMclXml(String(xml)));
ipcMain.handle('mcl:importFile', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Import MUSHclient triggers, aliases or timers',
    filters: [{ name: 'MUSHclient exports and worlds', extensions: ['mct', 'mca', 'mcm', 'xml', 'mcl', 'MCT', 'MCA', 'MCM', 'MCL', 'txt'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (res.canceled) return null;
  const file = res.filePaths[0];
  return { file: path.basename(file), ...parseMclXml(fs.readFileSync(file, 'latin1')) };
});

/* ---------- IPC: sessions ---------- */

ipcMain.handle('session:connect', (_e, worldId: string, size: { width: number; height: number }) => {
  const world = loadWorlds().find((w) => w.id === worldId);
  if (!world) throw new Error('World not found');
  const id = randomUUID();
  const telnet = new TelnetSession({
    host: world.host,
    port: world.port,
    encoding: world.encoding,
    width: size?.width ?? 100,
    height: size?.height ?? 40,
    mxp: world.mxp,
  });
  // MXP (shared/mxp.ts) and Pueblo (shared/pueblo.ts) turn the formatting tags a game sends into
  // ANSI before the renderer sees the text. One switch covers both; it is read once per connection.
  const mxp = new MxpFilter({ clientVersion: app.getVersion() });
  const pueblo = new PuebloFilter({ enabled: world.mxp, hash: () => randomBytes(16).toString('hex') });
  const s: Session = { id, world, telnet, mxp, pueblo, log: openLog(world), logHtml: world.log.format === 'html', logRaw: world.logging && world.log.format === 'raw' };
  sessions.set(id, s);

  // "Send on connect": held until the game has said something (or 1.5 s), then one line every
  // 250 ms. Sent the instant the socket opened, the first line (Haven's "y" to its colour
  // question) often arrived before the server was reading input and was lost.
  let autoTimer: NodeJS.Timeout | null = null;
  let autoSent = false;
  const sendAutoConnect = () => {
    if (autoSent) return;
    autoSent = true;
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    const lines = (world.autoConnect ?? '').split(/\r?\n/).filter((l) => l.trim());
    lines.forEach((line, i) => setTimeout(() => { if (sessions.get(id) === s) telnet.sendLine(line); }, 250 * (i + 1)));
  };

  const deliver = (events: { kind: string; text?: string; line?: string }[]) => {
    for (const ev of events) {
      if (ev.kind === 'text') send('session:text', id, ev.text);
      else if (ev.kind === 'send') telnet.sendLine(ev.line!);
      else send('session:info', id, ev.text);
    }
  };
  telnet.on('text', (text: string) => {
    // Raw diagnostic log: the exact bytes the game sent (telnet stripped), escapes shown as \e,
    // written here before MXP/Pueblo translation and before the renderer parses ANSI out. Lets
    // us see colour codes and formatting tags verbatim.
    if (s.logRaw && s.log) s.log.write(text.replace(/\x1b/g, '\\e').replace(/\r/g, ''));
    if (autoTimer) sendAutoConnect();
    for (const ev of mxp.feed(text)) {
      if (ev.kind === 'text') deliver(pueblo.feed(ev.text));
      else deliver([ev]);
    }
  });
  telnet.on('mxp', () => { mxp.on = true; });
  telnet.on('prompt', () => send('session:prompt', id));
  telnet.on('echo', (on: boolean) => send('session:echo', id, on));
  telnet.on('gmcp', (pkg: string, data: unknown) => send('session:gmcp', id, pkg, data));
  telnet.on('info', (msg: string) => send('session:info', id, msg));
  telnet.on('status', (status: string, message?: string) => {
    send('session:status', id, status, message);
    if (status === 'connected' && world.autoConnect?.trim()) autoTimer = setTimeout(sendAutoConnect, 1500);
    if (status === 'disconnected' || status === 'error') {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      // Anything MXP or Pueblo was holding back for a tag that never finished is shown as text.
      for (const ev of mxp.flush()) if (ev.kind === 'text') deliver(pueblo.feed(ev.text));
      deliver(pueblo.flush());
      // Give the renderer a moment to log the last lines it is still committing.
      const log = s.log; s.log = null;
      if (log) setTimeout(() => { log.write('\n'); log.end(); }, 500);
    }
  });
  telnet.connect();
  return id;
});

ipcMain.handle('session:send', (_e, id: string, text: string) => {
  const s = sessions.get(id);
  if (!s) return false;
  s.telnet.sendLine(text);
  return true;
});

ipcMain.on('session:log', (_e, id: string, text: string, _kind: string, html?: string) => {
  const s = sessions.get(id);
  if (s) logLine(s, text, html);
});

ipcMain.handle('session:disconnect', (_e, id: string) => {
  const s = sessions.get(id);
  s?.telnet.disconnect();
  return true;
});

ipcMain.handle('session:resize', (_e, id: string, width: number, height: number) => {
  sessions.get(id)?.telnet.resize(width, height);
});

/* ---------- IPC: scripts (one Lua file per world) ---------- */

const STARTER_SCRIPT = `-- Lantern script for this world. Saved to disk and reloaded on every connect
-- and whenever you press Save or Reload on the Script tab.
--
-- A trigger, alias or timer with a "Lua function" calls it as fn(name, line, wildcards):
--
-- function on_tell(name, line, wildcards)
--   ColourNote("yellow", "", wildcards[1] .. " told you: " .. wildcards[2])
--   SetVariable("last_tell", wildcards[1])
-- end
--
-- Send("say hello"), Execute("l"), Note(...), ColourNote(fg, bg, text), GetVariable(name),
-- AddTrigger(...), EnableGroup(name, true) and the rest work as in MUSHclient.
`;

function scriptsDir() {
  const dir = path.join(app.getPath('userData'), 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const scriptFile = (worldId: string) => path.join(scriptsDir(), `${String(worldId).replace(/[^A-Za-z0-9_-]/g, '_')}.lua`);

ipcMain.handle('scripts:read', (_e, worldId: string) => {
  try { return fs.readFileSync(scriptFile(worldId), 'utf-8'); } catch { return ''; }
});
ipcMain.handle('scripts:write', (_e, worldId: string, text: string) => {
  const file = scriptFile(worldId);
  fs.writeFileSync(file, String(text));
  return file;
});
ipcMain.handle('scripts:path', (_e, worldId: string) => scriptFile(worldId));
ipcMain.handle('scripts:open', async (_e, worldId: string) => {
  const file = scriptFile(worldId);
  if (!fs.existsSync(file)) fs.writeFileSync(file, STARTER_SCRIPT);
  return shell.openPath(file);
});

/* ---------- IPC: app ---------- */

ipcMain.handle('app:openLogs', () => shell.openPath(logsDir()));
ipcMain.handle('app:logsDir', () => logsDir());
ipcMain.handle('app:chooseFolder', async (_e, title?: string) => {
  const res = await dialog.showOpenDialog(win!, { title: title ?? 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('app:openExternal', (_e, url: string) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:about', () => aboutInfo());

/* ---------- IPC: updates (Settings › About) ---------- */

// `auto` is the startup check: skipped when running from source or in a smoke run, so dev
// runs do not ask GitHub every time. A click on "Check for updates" always asks.
ipcMain.handle('update:check', (_e, auto?: boolean) => {
  if (auto && (!app.isPackaged || process.env.LANTERN_SMOKE)) return null;
  return checkForUpdates();
});
ipcMain.handle('update:download', (_e, asset: ReleaseAsset) =>
  downloadUpdate(asset, (received, total) => send('update:progress', { received, total })));
ipcMain.handle('update:install', (_e, file: string, flavour: UpdateFlavour) => installUpdate(file, flavour));

/* ---------- IPC: installed fonts ---------- */

// Asked of Windows via .NET; the renderer's Local Font Access API needs a user gesture and a
// permission grant, which makes it flaky, so this is the primary source. PowerShell can take a
// while to start on some machines (security scanning, a cold .NET), so the last answer is kept
// in fonts-cache.json and served at once while a fresh listing runs behind it.
const fontCacheFile = () => path.join(app.getPath('userData'), 'fonts-cache.json');
let fontList: Promise<string[]> | null = null;

function enumerateFonts(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    const cmd = 'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 60000 }, (err, stdout) => {
      if (err) { console.warn('font listing failed:', err.message); resolve([]); return; }
      resolve(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)));
    });
  });
}

function installedFonts(): Promise<string[]> {
  if (fontList) return fontList;
  let cached: string[] = [];
  try { const j = JSON.parse(fs.readFileSync(fontCacheFile(), 'utf-8')); if (Array.isArray(j)) cached = j.filter((s) => typeof s === 'string'); } catch { /* no cache yet */ }
  const fresh = enumerateFonts().then((list) => {
    if (list.length) {
      try { fs.mkdirSync(path.dirname(fontCacheFile()), { recursive: true }); fs.writeFileSync(fontCacheFile(), JSON.stringify(list)); } catch { /* read-only profile: fine */ }
      fontList = Promise.resolve(list);
    }
    return list;
  });
  fontList = cached.length ? Promise.resolve(cached) : fresh;
  return fontList;
}
ipcMain.handle('fonts:list', () => installedFonts());

/* ---------- IPC: app settings (fonts etc.) ---------- */

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings(): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')); } catch { return null; }
}
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, settings: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  if (Array.isArray(settings?.spellLanguages)) applySpellLanguages(settings.spellLanguages as string[]);
});

/* ---------- spell check ---------- */

function applySpellLanguages(langs: string[]) {
  const ses = electronSession.defaultSession;
  const available = ses.availableSpellCheckerLanguages;
  // Keep only codes Chromium actually ships; fall back to en-US if nothing matches.
  const use = langs.filter((l) => available.includes(l));
  try { ses.setSpellCheckerLanguages(use.length ? use : available.includes('en-US') ? ['en-US'] : []); } catch { /* ignore */ }
}
ipcMain.handle('spell:languages', () => {
  const ses = electronSession.defaultSession;
  return { available: ses.availableSpellCheckerLanguages, active: ses.getSpellCheckerLanguages() };
});

app.whenReady().then(() => { createWindow(); installedFonts(); });
app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.telnet.disconnect();
  app.quit();
});
