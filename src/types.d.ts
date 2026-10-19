import type { World } from './lib/store';

type Unsub = () => void;

declare global {
  interface Window {
    lantern: {
      worlds: {
        list(): Promise<World[]>;
        save(worlds: World[]): Promise<World[]>;
        create(partial?: Partial<World>): Promise<World>;
        importMcl(): Promise<World[]>;
      };
      session: {
        connect(worldId: string, size: { width: number; height: number }): Promise<string>;
        disconnect(sessionId: string): Promise<boolean>;
        send(sessionId: string, text: string): Promise<boolean>;
        resize(sessionId: string, width: number, height: number): Promise<void>;
        onText(cb: (id: string, text: string) => void): Unsub;
        onStatus(cb: (id: string, status: 'connecting' | 'connected' | 'disconnected' | 'error', message?: string) => void): Unsub;
        onPrompt(cb: (id: string) => void): Unsub;
        onEcho(cb: (id: string, on: boolean) => void): Unsub;
        onGmcp(cb: (id: string, pkg: string, data: unknown) => void): Unsub;
        onInfo(cb: (id: string, message: string) => void): Unsub;
      };
      app: {
        openLogs(): Promise<string>;
        openExternal(url: string): Promise<void>;
        version(): Promise<string>;
        onSmoke(cb: (opts: { host: string; port: number; panel?: boolean }) => void): Unsub;
      };
    };
  }
}

export {};
