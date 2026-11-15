// Bridges the in-game profile pill to the profile modal. Two jobs:
//  1. When the output detects a My Haven profile block (store.markProfile), it stashes that block's
//     text here, keyed by handle — the game's own fixed-font, correctly-coloured About Me. The modal
//     pairs it with the scraped photos.
//  2. Clicking the "view @handle profile" pill calls openProfile(handle); App subscribes and opens
//     the modal. Like the lightbox, this keeps the memoized output render free of per-line callbacks.

import type { Span } from './ansi';
import { handleKey } from '../../shared/profiles';

// Most-recent in-game profile text per handle (lines of coloured spans). Capped so a long session
// doesn't accumulate forever.
const captures = new Map<string, Span[][]>();
const MAX_CAPTURES = 200;

export function setProfileCapture(handle: string, lines: Span[][]): void {
  const k = handleKey(handle);
  captures.delete(k); // re-insert so it counts as most-recent for the cap below
  captures.set(k, lines);
  if (captures.size > MAX_CAPTURES) captures.delete(captures.keys().next().value as string);
}

export function getProfileCapture(handle: string): Span[][] | null {
  return captures.get(handleKey(handle)) ?? null;
}

type Listener = (handle: string) => void;
const listeners = new Set<Listener>();

/** Open the profile modal for this handle (from a clicked pill). */
export function openProfile(handle: string): void {
  listeners.forEach((fn) => fn(handle));
}

/** Subscribe to profile-open requests; App mounts the modal. Returns an unsubscribe. */
export function onOpenProfile(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
