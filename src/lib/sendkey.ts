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
  // In "ctrl-enter" mode a plain Enter sends while every line is short — a quick command, or a stack
  // of short ones like pasted directions (n / ne / up …), which shouldn't need Ctrl+Enter just for
  // being on several lines. It falls through to a new line once any line runs long: a multi-line
  // pose (which has real prose lines) still needs Ctrl+Enter, so it can't fire half-written.
  if (mode === 'ctrl-enter') return value.split('\n').every((line) => line.length <= SHORT_SEND_MAX);
  // "button" mode: a plain Enter is always a new line (use the Send button or Ctrl+Enter).
  return false;
}
