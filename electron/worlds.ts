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
  // Items a script added with the Temporary flag live only as long as the session. Coerce to an
  // array first: a single world with a missing list must never abort the whole save (that once
  // left edits live in the session but never written to disk).
  const keep = <T extends { temporary?: boolean }>(xs: T[] | undefined | null): T[] =>
    (Array.isArray(xs) ? xs.filter((x) => x && !x.temporary) : []);
  const onDisk = worlds.map((w) => ({ ...w, triggers: keep(w.triggers), aliases: keep(w.aliases), timers: keep(w.timers) }));
  // Write atomically via a temp file so a crash mid-write can't truncate the real file.
  const target = file();
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2));
  fs.renameSync(tmp, target);
}

export function newWorld(partial: Partial<World> = {}): World {
  return normalizeWorld({ id: randomUUID(), ...partial });
}
