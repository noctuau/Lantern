// Scrapes the public My Haven character pages into a local cache. The handle and the photos are
// injected by the site's JavaScript (not in the raw HTML and not in any API/feed — all checked), so
// the only way to read them is to actually render each page. We do that in a hidden, sandboxed
// BrowserWindow with image loading switched off (we only need the DOM, not the pixels), visiting each
// profile once and reading name / @handle / photo URLs out of the rendered DOM.
//
// The user triggers this from a "Refresh profiles" button — never automatically — because it's ~40
// page loads against someone else's server. The About Me text is deliberately not captured here; the
// in-game profile already provides it in clean monospace with the player's colours.

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { handleKey, type Profile, type ProfileCache } from '../shared/profiles';

const DIRECTORY = 'https://havenrpg.net/newsite/h5-characters/';
const PER_PAGE_TIMEOUT = 12000;

function cacheFile() { return path.join(app.getPath('userData'), 'profiles.json'); }

export function readProfileCache(): ProfileCache {
  try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as ProfileCache; }
  catch { return { updatedAt: 0, profiles: {} }; }
}

function writeProfileCache(cache: ProfileCache) {
  try { fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2)); } catch { /* disk full / locked: keep the in-memory copy */ }
}

/** Look up one profile by handle (with or without a leading @). */
export function lookupProfile(handle: string): Profile | null {
  return readProfileCache().profiles[handleKey(handle)] ?? null;
}

// --- extractors (run inside the scrape window, so plain DOM strings only) ---

// The directory lists every active character as a link to /h5-characters/h5-<name-slug>/.
const DIR_EXTRACT = `(() => [...document.querySelectorAll('a[href*="/h5-characters/h5-"]')]
  .map(a => ({ name: (a.textContent||'').trim(), url: a.href }))
  .filter(x => x.name && /\\/h5-characters\\/h5-[^/]+\\/?$/.test(x.url)))()`;

// name from the H1, @handle from the header badge, photos from the carousel <img>s.
const PROFILE_EXTRACT = `(() => {
  const name = ((document.querySelector('h1.rpg-character-name') || document.querySelector('h1'))?.textContent || '').trim();
  const hraw = (document.querySelector('.rpg-header .rpg-follower-count') || document.querySelector('.rpg-follower-count'))?.textContent || '';
  const hm = hraw.match(/@([\\w$.\\-]+)/);
  const handle = hm ? hm[1] : '';
  const photos = [...document.querySelectorAll('img.rpg-carousel-image')]
    .map(i => i.getAttribute('src') || '')
    .filter(s => /^https?:/.test(s));
  return { name, handle, photos };
})()`;

// true once the JS-injected handle badge has appeared (how we know the page has finished hydrating).
const HANDLE_READY = `(() => { const e = document.querySelector('.rpg-header .rpg-follower-count') || document.querySelector('.rpg-follower-count'); return !!(e && /@/.test(e.textContent || '')); })()`;
const DIR_READY = `document.querySelectorAll('a[href*="/h5-characters/h5-"]').length > 0`;

async function waitFor(win: BrowserWindow, expr: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (win.isDestroyed()) return false;
    const ok = await win.webContents.executeJavaScript(expr, true).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export type ProfileProgress = (done: number, total: number, name: string) => void;

/**
 * Re-scrape every active profile and overwrite the cache. Returns the fresh cache. Runs one hidden
 * window, visiting pages sequentially to stay gentle on the server.
 */
export async function refreshProfiles(onProgress?: ProfileProgress): Promise<ProfileCache> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      images: false,            // we only read img.src strings; never download the pixels
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:haven-scrape',
      backgroundThrottling: false,
    },
  });
  try {
    await win.loadURL(DIRECTORY);
    await waitFor(win, DIR_READY, PER_PAGE_TIMEOUT);
    const list: { name: string; url: string }[] = await win.webContents.executeJavaScript(DIR_EXTRACT, true).catch(() => []);
    // de-dup by URL (the page links each name more than once)
    const seen = new Set<string>();
    const chars = list.filter((c) => { const k = c.url.replace(/\/$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });

    const profiles: Record<string, Profile> = {};
    let done = 0;
    for (const c of chars) {
      try {
        await win.loadURL(c.url);
        await waitFor(win, HANDLE_READY, PER_PAGE_TIMEOUT);
        const data = await win.webContents.executeJavaScript(PROFILE_EXTRACT, true) as { name: string; handle: string; photos: string[] };
        if (data?.handle) {
          profiles[handleKey(data.handle)] = { handle: data.handle, name: data.name || c.name, url: c.url, photos: data.photos || [] };
        }
      } catch { /* one bad page shouldn't sink the whole run */ }
      onProgress?.(++done, chars.length, c.name);
    }

    const cache: ProfileCache = { updatedAt: Date.now(), profiles };
    writeProfileCache(cache);
    return cache;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
