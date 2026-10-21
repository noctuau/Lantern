import type { World } from './lib/store';
import type { Trigger, Alias, Timer } from '../shared/types';
import type { UpdateInfo, ReleaseAsset, UpdateFlavour } from '../shared/updates';

type MclItems = { triggers: Trigger[]; aliases: Alias[]; timers: Timer[] };

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
        /** One finished line for the world's daily log (fire and forget). */
        log(sessionId: string, text: string, kind: 'output' | 'command' | 'note', html?: string): void;
        onText(cb: (id: string, text: string) => void): Unsub;
        onStatus(cb: (id: string, status: 'connecting' | 'connected' | 'disconnected' | 'error', message?: string) => void): Unsub;
        onPrompt(cb: (id: string) => void): Unsub;
        onEcho(cb: (id: string, on: boolean) => void): Unsub;
        onGmcp(cb: (id: string, pkg: string, data: unknown) => void): Unsub;
        onInfo(cb: (id: string, message: string) => void): Unsub;
      };
      mcl: {
        parse(xml: string): Promise<MclItems>;
        importFile(): Promise<(MclItems & { file: string }) | null>;
      };
      scripts: {
        read(worldId: string): Promise<string>;
        write(worldId: string, text: string): Promise<string>;
        open(worldId: string): Promise<string>;
        path(worldId: string): Promise<string>;
      };
      fonts: {
        list(): Promise<string[]>;
      };
      settings: {
        get(): Promise<Record<string, unknown> | null>;
        set(settings: Record<string, unknown>): Promise<void>;
      };
      spell: {
        languages(): Promise<{ available: string[]; active: string[] }>;
      };
      app: {
        openLogs(): Promise<string>;
        chooseFolder(title?: string): Promise<string | null>;
        logsDir(): Promise<string>;
        openExternal(url: string): Promise<void>;
        version(): Promise<string>;
        about(): Promise<{ version: string; electron: string; chrome: string; node: string; packaged: boolean; flavour: UpdateFlavour }>;
        onSmoke(cb: (opts: { host: string; port: number; panel?: string; view?: string; auto?: string }) => void): Unsub;
      };
      update: {
        /** The latest GitHub release vs this version. `auto` (the startup check) returns null from source or smoke runs. */
        check(auto?: boolean): Promise<UpdateInfo | null>;
        /** Download a release asset to the temp folder; progress arrives on onProgress. Resolves to the file path. */
        download(asset: ReleaseAsset): Promise<string>;
        /** Run the downloaded installer and quit, or show the portable exe. */
        install(file: string, flavour: UpdateFlavour): Promise<'launched' | 'shown'>;
        onProgress(cb: (p: { received: number; total: number }) => void): Unsub;
      };
    };
  }
}

export {};
