/**
 * Recently-used colour-composer gradients, kept per machine in localStorage (not settings.json): a
 * gradient is "used" when it's inserted into the command box. The composer shows these as quick-pick
 * chips so a gradient you just used is one click away, and as a fallback before anything is starred.
 */
import type { ColourMode } from './gradient';

export interface RecentGradient { mode: ColourMode; codes: string; name?: string }

const KEY = 'lantern.recentGradients';
const CAP = 12;

export function loadRecents(): RecentGradient[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is RecentGradient => !!r && typeof (r as RecentGradient).codes === 'string'
        && ((r as RecentGradient).mode === 'xterm' || (r as RecentGradient).mode === 'html'))
      .slice(0, CAP);
  } catch { return []; }
}

/** Record a used gradient at the front (most recent first), de-duplicated by mode+codes. */
export function pushRecent(entry: RecentGradient): RecentGradient[] {
  const codes = entry.codes.trim();
  if (!codes) return loadRecents();
  const list = loadRecents().filter((r) => !(r.mode === entry.mode && r.codes === codes));
  list.unshift(entry.name ? { mode: entry.mode, codes, name: entry.name } : { mode: entry.mode, codes });
  const trimmed = list.slice(0, CAP);
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* storage blocked: just don't remember */ }
  return trimmed;
}
