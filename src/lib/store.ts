/**
 * Session state: one entry per open connection. A tiny external store so the
 * high-frequency output path doesn't go through React state for every chunk.
 */
import { useSyncExternalStore } from 'react';
import { AnsiParser, type Span } from './ansi';

export type LineKind = 'mud' | 'input' | 'note' | 'error';
export interface Line { id: number; kind: LineKind; spans: Span[]; ts: number; prompt?: boolean }

export interface World {
  id: string; name: string; host: string; port: number; encoding: string;
  notes?: string; logging: boolean; autoConnect?: string; createdAt: string;
}

export interface SessionState {
  id: string;
  world: World;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  statusMessage?: string;
  lines: Line[];
  partial: Span[];       // the current unfinished line (usually the prompt)
  echo: boolean;         // false while the server is masking input (password)
  history: string[];
  unread: number;
  connectedAt?: number;
  gmcp: Record<string, unknown>;
}

const MAX_LINES = 10_000;

class Store {
  sessions = new Map<string, SessionState>();
  order: string[] = [];
  activeId: string | null = null;
  private parsers = new Map<string, AnsiParser>();
  private listeners = new Set<() => void>();
  private lineId = 1;
  private snapshot = 0;
  private flushTimer: number | null = null;

  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  getSnapshot = () => this.snapshot;

  private notify() {
    this.snapshot++;
    for (const l of this.listeners) l();
  }
  /** Coalesce bursts of output into one render per animation frame. */
  private scheduleNotify() {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.requestAnimationFrame(() => { this.flushTimer = null; this.notify(); });
  }

  add(id: string, world: World) {
    this.sessions.set(id, {
      id, world, status: 'connecting', lines: [], partial: [], echo: true, history: [], unread: 0, gmcp: {},
    });
    this.parsers.set(id, new AnsiParser());
    this.order.push(id);
    this.activeId = id;
    this.notify();
  }

  remove(id: string) {
    this.sessions.delete(id);
    this.parsers.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.activeId === id) this.activeId = this.order[this.order.length - 1] ?? null;
    this.notify();
  }

  setActive(id: string) {
    this.activeId = id;
    const s = this.sessions.get(id);
    if (s) s.unread = 0;
    this.notify();
  }

  get(id: string) { return this.sessions.get(id); }
  active() { return this.activeId ? this.sessions.get(this.activeId) : undefined; }

  setStatus(id: string, status: SessionState['status'], message?: string) {
    const s = this.sessions.get(id); if (!s) return;
    s.status = status; s.statusMessage = message;
    if (status === 'connected') s.connectedAt = Date.now();
    const text = status === 'connected' ? `Connected to ${s.world.host}:${s.world.port}`
      : status === 'connecting' ? `Connecting to ${s.world.host}:${s.world.port}…`
      : status === 'error' ? `Connection error: ${message ?? 'unknown'}`
      : 'Disconnected.';
    this.note(id, text, status === 'error' ? 'error' : 'note');
  }

  setEcho(id: string, on: boolean) { const s = this.sessions.get(id); if (s) { s.echo = on; this.notify(); } }

  setGmcp(id: string, pkg: string, data: unknown) {
    const s = this.sessions.get(id); if (!s) return;
    s.gmcp[pkg] = data; this.scheduleNotify();
  }

  /** Text from the MUD. */
  text(id: string, chunk: string) {
    const s = this.sessions.get(id); const p = this.parsers.get(id);
    if (!s || !p) return;
    for (const tok of p.feed(chunk)) {
      if (tok.type === 'text') s.partial.push(tok.span);
      else this.commitPartial(s, 'mud');
    }
    if (id !== this.activeId) { /* unread counts lines, bumped in commitPartial */ }
    this.scheduleNotify();
  }

  /** EOR/GA: the partial line is a prompt. Keep it visible but mark it. */
  prompt(id: string) {
    const s = this.sessions.get(id); if (!s) return;
    if (s.partial.length) {
      this.commitPartial(s, 'mud', true);
      this.scheduleNotify();
    }
  }

  private commitPartial(s: SessionState, kind: LineKind, prompt = false) {
    const merged = mergeSpans(s.partial);
    s.partial = [];
    this.pushLine(s, { id: this.lineId++, kind, spans: merged, ts: Date.now(), prompt });
  }

  private pushLine(s: SessionState, line: Line) {
    s.lines.push(line);
    if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
    if (s.id !== this.activeId) s.unread++;
  }

  note(id: string, text: string, kind: LineKind = 'note') {
    const s = this.sessions.get(id); if (!s) return;
    if (s.partial.length) this.commitPartial(s, 'mud');
    this.pushLine(s, { id: this.lineId++, kind, spans: [{ text, style: plain() }], ts: Date.now() });
    this.scheduleNotify();
  }

  /** Echo the user's own command into the output. */
  input(id: string, text: string) {
    const s = this.sessions.get(id); if (!s) return;
    // If a prompt line is pending, the command visually completes it.
    if (s.partial.length) this.commitPartial(s, 'mud', true);
    this.pushLine(s, { id: this.lineId++, kind: 'input', spans: [{ text, style: plain() }], ts: Date.now() });
    if (text.trim() && s.history[s.history.length - 1] !== text) {
      s.history.push(text);
      if (s.history.length > 500) s.history.shift();
    }
    this.scheduleNotify();
  }
}

function plain() {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false };
}

function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (last && sameStyle(last.style, sp.style)) last.text += sp.text;
    else out.push({ text: sp.text, style: sp.style });
  }
  return out;
}

function sameStyle(a: Span['style'], b: Span['style']) {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic
    && a.underline === b.underline && a.strike === b.strike && a.inverse === b.inverse;
}

export const store = new Store();

export function useStore() {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return store;
}
