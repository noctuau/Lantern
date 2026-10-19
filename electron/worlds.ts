/** World (server/character profile) persistence: a JSON file in userData. */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { normalizeWorld, type World } from '../shared/types';

export type { World } from '../shared/types';
export { importMcl } from './mcl';

const file = () => path.join(app.getPath('userData'), 'worlds.json');

export function loadWorlds(): World[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf-8')) as Partial<World>[];
    return raw.map((w) => normalizeWorld({ ...w, id: w.id ?? randomUUID() }));
  } catch { return []; }
}

export function saveWorlds(worlds: World[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(worlds, null, 2));
}

export function newWorld(partial: Partial<World> = {}): World {
  return normalizeWorld({ id: randomUUID(), ...partial });
}
