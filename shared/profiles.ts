// My Haven profile cache. Lantern scrapes the public character pages on havenrpg.net (handle, name,
// photos) into a local file so that, when you pull up a profile in-game, clicking the injected pill
// can show the photos next to the game's own fixed-font About Me text. The About Me text itself is NOT
// scraped — the in-game copy is already perfect monospace with the player's real colours, and the web
// copy is padded for a proportional font. See electron/profiles.ts.

export interface Profile {
  /** The @handle, without the leading @ (e.g. "Lies", "K$B"). */
  handle: string;
  /** Full character name, e.g. "Liesel Winterbach". */
  name: string;
  /** The profile page the data came from. */
  url: string;
  /** Carousel photo URLs (imgur etc.), in page order. */
  photos: string[];
}

export interface ProfileCache {
  /** When the scrape last finished (epoch ms); 0 if never. */
  updatedAt: number;
  /** Keyed by handle.toLowerCase(). */
  profiles: Record<string, Profile>;
}

/** Normalise a handle for use as a cache key: strip a leading @, lowercase. */
export function handleKey(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}
