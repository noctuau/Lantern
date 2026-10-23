/** Decide whether a given Enter keypress should send the command, per the Settings send mode. */
import type { SendMode } from './settings';

/** A single line up to this many characters still sends on a plain Enter in "ctrl-enter" mode. */
export const SHORT_SEND_MAX = 80;

export function entrySends(mode: SendMode, opts: { mod: boolean; shift: boolean; value: string }): boolean {
  const { mod, shift, value } = opts;
  // Shift+Enter is always a new line, never a send.
  if (shift) return false;
  // Plain Enter sends in "enter" mode.
  if (mode === 'enter') return true;
  // Ctrl/Cmd+Enter always sends in the other modes.
  if (mod) return true;
  // In "ctrl-enter" mode a plain Enter still sends a short single line, so quick commands aren't a
  // chore, but makes a new line once the text is long or already spans more than one line.
  if (mode === 'ctrl-enter') return !value.includes('\n') && value.length <= SHORT_SEND_MAX;
  // "button" mode: a plain Enter is always a new line (use the Send button or Ctrl+Enter).
  return false;
}
