import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
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
  logLineBuf: string;
}

// Smoke runs use a throwaway profile so they never touch the real world list or logs.
if (process.env.LANTERN_SMOKE) app.setPath('userData', path.join(app.getPath('temp'), 'lantern-smoke'));

const sessions = new Map<string, Session>();
let win: BrowserWindow | null = null;

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Lantern',
    backgroundColor: '#14120f',
    autoHideMenuBar: true,
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
      setTimeout(() => send('smoke:run', { host, port: Number(port), panel: process.env.LANTERN_SMOKE_PANEL === '1' }), 500);
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

function logText(s: Session, text: string) {
  if (!s.log) return;
  // Buffer up to the last newline so escape sequences split across chunks are stripped cleanly.
  s.logLineBuf += text;
  const nl = s.logLineBuf.lastIndexOf('\n');
  if (nl === -1) return;
  const complete = s.logLineBuf.slice(0, nl + 1);
  s.logLineBuf = s.logLineBuf.slice(nl + 1);
  s.log.write(complete.replace(ANSI_RE, '').replace(/\r/g, ''));
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
  const s: Session = { id, world, telnet, log: openLog(world), logLineBuf: '' };
  sessions.set(id, s);

  telnet.on('text', (text: string) => { send('session:text', id, text); logText(s, text); });
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
      if (s.log) { logText(s, '\n'); s.log.end(); s.log = null; }
    }
  });
  telnet.connect();
  return id;
});

ipcMain.handle('session:send', (_e, id: string, text: string) => {
  const s = sessions.get(id);
  if (!s) return false;
  s.telnet.sendLine(text);
  if (!s.telnet.serverEcho) logText(s, `> ${text}\n`);
  return true;
});

ipcMain.handle('session:disconnect', (_e, id: string) => {
  const s = sessions.get(id);
  s?.telnet.disconnect();
  return true;
});

ipcMain.handle('session:resize', (_e, id: string, width: number, height: number) => {
  sessions.get(id)?.telnet.resize(width, height);
});

/* ---------- IPC: app ---------- */

ipcMain.handle('app:openLogs', () => shell.openPath(logsDir()));
ipcMain.handle('app:openExternal', (_e, url: string) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
ipcMain.handle('app:version', () => app.getVersion());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.telnet.disconnect();
  app.quit();
});
