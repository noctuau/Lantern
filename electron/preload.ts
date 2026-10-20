import { contextBridge, ipcRenderer } from 'electron';

const on = (channel: string) => (cb: (...args: any[]) => void) => {
  const handler = (_e: unknown, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('lantern', {
  worlds: {
    list: () => ipcRenderer.invoke('worlds:list'),
    save: (worlds: unknown[]) => ipcRenderer.invoke('worlds:save', worlds),
    create: (partial?: unknown) => ipcRenderer.invoke('worlds:create', partial),
    importMcl: () => ipcRenderer.invoke('worlds:importMcl'),
  },
  session: {
    connect: (worldId: string, size: { width: number; height: number }) =>
      ipcRenderer.invoke('session:connect', worldId, size),
    disconnect: (sessionId: string) => ipcRenderer.invoke('session:disconnect', sessionId),
    send: (sessionId: string, text: string) => ipcRenderer.invoke('session:send', sessionId, text),
    resize: (sessionId: string, width: number, height: number) =>
      ipcRenderer.invoke('session:resize', sessionId, width, height),
    onText: on('session:text'),
    onStatus: on('session:status'),
    onPrompt: on('session:prompt'),
    onEcho: on('session:echo'),
    onGmcp: on('session:gmcp'),
    onInfo: on('session:info'),
  },
  scripts: {
    read: (worldId: string) => ipcRenderer.invoke('scripts:read', worldId),
    write: (worldId: string, text: string) => ipcRenderer.invoke('scripts:write', worldId, text),
    open: (worldId: string) => ipcRenderer.invoke('scripts:open', worldId),
    path: (worldId: string) => ipcRenderer.invoke('scripts:path', worldId),
  },
  app: {
    openLogs: () => ipcRenderer.invoke('app:openLogs'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    version: () => ipcRenderer.invoke('app:version'),
    onSmoke: on('smoke:run'),
  },
});
