/** World (server/character profile) persistence: a JSON file in userData. */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

export interface World {
  id: string;
  name: string;
  host: string;
  port: number;
  encoding: string;         // 'utf-8' | 'latin1'
  notes?: string;
  logging: boolean;
  /** Text sent automatically after connecting (e.g. "connect name password"). Plain text for now. */
  autoConnect?: string;
  createdAt: string;
}

const file = () => path.join(app.getPath('userData'), 'worlds.json');

export function loadWorlds(): World[] {
  try { return JSON.parse(fs.readFileSync(file(), 'utf-8')); } catch { return []; }
}

export function saveWorlds(worlds: World[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(worlds, null, 2));
}

export function newWorld(partial: Partial<World> = {}): World {
  return {
    id: randomUUID(),
    name: 'New world',
    host: '',
    port: 4000,
    encoding: 'utf-8',
    logging: true,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

/** Pull the useful bits out of a MUSHclient .MCL world file. */
export function importMcl(xml: string): Partial<World> {
  const attr = (name: string) => {
    const m = xml.match(new RegExp('\\b' + name + '="([^"]*)"'));
    return m ? m[1] : undefined;
  };
  const w: Partial<World> = {};
  const name = attr('name'); if (name) w.name = name;
  const site = attr('site'); if (site) w.host = site;
  // The world's own port is on its own indented line; chat_port / proxy_port carry prefixes.
  const portMatch = xml.match(/\n\s+port="(\d+)"/);
  if (portMatch) w.port = Number(portMatch[1]);
  w.encoding = attr('utf_8') === 'y' ? 'utf-8' : 'latin1';
  const log = attr('log_output'); if (log) w.logging = log === 'y';
  const conn = attr('connect_text');
  if (conn) w.autoConnect = conn.replace(/&#10;|&#13;/g, '\n').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return w;
}
