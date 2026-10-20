import { app, BrowserWindow, ipcMain, dialog, shell, session as electronSession } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TelnetSession } from './telnet';
import { loadWorlds, saveWorlds, newWorld, importMcl, type World } from './worlds';

interface Session {
  id: string;
  world: World;
  telnet: TelnetSession;
  log: fs.WriteStream | null;
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

  win.on('closed', () => { win = null; });

  // Smoke test: LANTERN_SMOKE=host:port:out.png connects, waits, screenshots the window, quits.
  const smoke = process.env.LANTERN_SMOKE;
  if (smoke) {
    const [host, port, out] = smoke.split('|');
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => send('smoke:run', { host, port: Number(port), panel: process.env.LANTERN_SMOKE_PANEL, view: process.env.LANTERN_SMOKE_VIEW }), 500);
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
  const safe = world.name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'world';
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(logsDir(), `${safe} ${stamp}.txt`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  stream.write(`\n===== ${world.name} — ${new Date().toLocaleString()} =====\n`);
  return stream;
}

/**
 * The renderer logs line by line (store.ts) once it knows what each finished line is: game text,
 * a typed command, a gagged line, or a line captured by a channel tab (prefixed with the tab name).
 */
function logLine(s: Session, text: string) {
  if (!s.log) return;
  s.log.write(String(text).replace(/\r/g, '') + '\n');
}

/* ---------- IPC: worlds ---------- */

ipcMain.handle('worlds:list', () => loadWorlds());
ipcMain.handle('worlds:save', (_e, worlds: World[]) => { saveWorlds(worlds); return loadWorlds(); });
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
  });
  const s: Session = { id, world, telnet, log: openLog(world) };
  sessions.set(id, s);

  telnet.on('text', (text: string) => send('session:text', id, text));
  telnet.on('prompt', () => send('session:prompt', id));
  telnet.on('echo', (on: boolean) => send('session:echo', id, on));
  telnet.on('gmcp', (pkg: string, data: unknown) => send('session:gmcp', id, pkg, data));
  telnet.on('info', (msg: string) => send('session:info', id, msg));
  telnet.on('status', (status: string, message?: string) => {
    send('session:status', id, status, message);
    if (status === 'connected' && world.autoConnect) {
      for (const line of world.autoConnect.split(/\r?\n/)) if (line.trim()) telnet.sendLine(line);
    }
    if (status === 'disconnected' || status === 'error') {
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

ipcMain.on('session:log', (_e, id: string, text: string) => {
  const s = sessions.get(id);
  if (s) logLine(s, text);
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
ipcMain.handle('app:openExternal', (_e, url: string) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
ipcMain.handle('app:version', () => app.getVersion());

/* ---------- IPC: app settings (fonts etc.) ---------- */

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
ipcMain.handle('settings:get', () => {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')); } catch { return null; }
});
ipcMain.handle('settings:set', (_e, settings: unknown) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.telnet.disconnect();
  app.quit();
});
