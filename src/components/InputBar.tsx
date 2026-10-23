import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionState } from '../lib/store';
import type { SendMode } from '../lib/settings';
import { entrySends } from '../lib/sendkey';
import { activePrefix, PREFIX_BYPASS } from '../lib/channels';

interface Props {
  session: SessionState;
  /** Resting height of the box in lines (from settings). */
  minLines: number;
  /** How a command is sent: Enter, Ctrl+Enter, or a Send button only (Settings). */
  sendMode: SendMode;
  /** Spell-check the command box (off is lighter on slow machines). */
  spellCheckInput: boolean;
  onResize(lines: number): void;
  onSend(text: string): void;
  onReconnect(): void;
  /** Hand the parent a function to drop text into the box (used by the colour composer). */
  registerInsert?(fn: (text: string) => void): void;
  /** Hand the parent a getter for the box's currently selected text (used to pre-fill the composer). */
  registerGetSelection?(fn: () => string): void;
}

const MAX_LINES = 20;
const BOX_PADDING = 18; // vertical padding + border of .input

export function InputBar({ session, minLines, sendMode, spellCheckInput, onResize, onSend, onReconnect, registerInsert, registerGetSelection }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [lines, setLines] = useState(minLines);
  // On-demand spell check: when live spell check is off, this turns the native checker on for the
  // box until the next send, so a quick check costs nothing the rest of the time.
  const [checkNow, setCheckNow] = useState(false);
  const histIdx = useRef<number | null>(null);   // null = not browsing history
  const draft = useRef('');

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { setLines(minLines); }, [minLines]);

  // Let the parent insert text (e.g. from the colour composer). Text selected in the box is replaced
  // by it (the selection survives the dialog, since selectionStart/End persist through blur), which is
  // what colouring a phrase inside a pose wants. Otherwise an empty box takes the text as-is, and a box
  // with something in it gets the insert on its own new line at the end so it never gets jammed onto
  // an existing command.
  const insert = useCallback((t: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? 0, end = el?.selectionEnd ?? 0;
    const replacing = !!el && end > start;
    let caret = -1;   // -1 = end of the box
    setValue((v) => {
      if (replacing) { caret = start + t.length; return v.slice(0, start) + t + v.slice(end); }
      if (v.trim() === '') return t;
      return v.replace(/\n+$/, '') + '\n' + t;
    });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const at = caret >= 0 ? caret : el.value.length;
      el.setSelectionRange(at, at);
    });
  }, []);
  useEffect(() => { registerInsert?.(insert); }, [registerInsert, insert]);

  // Expose the currently selected text (selectionStart/End survive blur, so the composer button
  // can read it even after focus moves to the button).
  const getSelection = useCallback(() => {
    const el = ref.current;
    return el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
  }, []);
  useEffect(() => { registerGetSelection?.(getSelection); }, [registerGetSelection, getSelection]);

  const lineHeight = () => {
    const el = ref.current;
    const lh = el ? parseFloat(getComputedStyle(el).lineHeight) : 22;
    return Number.isFinite(lh) ? lh : 22;
  };

  // The box rests at `lines` tall and grows with the text up to MAX_LINES. This is done with CSS
  // (field-sizing: content plus the min/max-height below in `lh` units), so no per-keystroke
  // measuring: an earlier JS version read scrollHeight on every keypress, forcing a full-page
  // reflow that stuttered badly against a long scrollback.

  // Drag the top edge to change the resting height; persisted on release.
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startLines = lines;
    const lh = lineHeight();
    let current = startLines;
    const move = (ev: MouseEvent) => {
      current = Math.min(MAX_LINES, Math.max(1, Math.round(startLines + (startY - ev.clientY) / lh)));
      setLines(current);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (current !== minLines) onResize(current);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const send = () => {
    const text = value;
    onSend(text);
    setValue('');
    setCheckNow(false);
    histIdx.current = null;
    draft.current = '';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const h = session.history;
    if (e.key === 'Enter') {
      // See src/lib/sendkey.ts. In "ctrl-enter" mode a short one-liner still sends on Enter, but a
      // long or multi-line pose needs Ctrl+Enter, so quick commands aren't a chore. Whatever doesn't
      // send falls through to a new line.
      if (entrySends(sendMode, { mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, value })) { e.preventDefault(); send(); return; }
      return;
    }
    if (e.key === 'Escape') { setValue(''); histIdx.current = null; return; }

    const caretOnFirstLine = el.value.lastIndexOf('\n', el.selectionStart - 1) === -1;
    const caretOnLastLine = el.value.indexOf('\n', el.selectionEnd) === -1;

    if (e.key === 'ArrowUp' && caretOnFirstLine && h.length) {
      e.preventDefault();
      if (histIdx.current === null) { draft.current = el.value; histIdx.current = h.length - 1; }
      else if (histIdx.current > 0) histIdx.current--;
      setValue(h[histIdx.current]);
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
      return;
    }
    if (e.key === 'ArrowDown' && caretOnLastLine && histIdx.current !== null) {
      e.preventDefault();
      if (histIdx.current < h.length - 1) { histIdx.current++; setValue(h[histIdx.current]); }
      else { histIdx.current = null; setValue(draft.current); }
      return;
    }
  };

  const disconnected = session.status === 'disconnected' || session.status === 'error';

  // The active channel tab's command prefix (see docs/channel-tabs.md): shown as a chip so it is
  // visible while typing, and named in the placeholder. Dimmed while the command starts with "\",
  // which sends that one command without it. Masked input never gets a prefix.
  const prefix = session.echo ? activePrefix(session.world.channelTabs, session.view) : '';
  const bypassing = !!prefix && value.startsWith(PREFIX_BYPASS);
  const sendHint = sendMode === 'ctrl-enter' ? 'Enter sends a short line; Ctrl+Enter for a long pose'
    : sendMode === 'button' ? 'Send button, or Ctrl+Enter; Enter makes a new line'
    : 'Shift+Enter for a new line, ↑ for history';
  const placeholder = !session.echo ? 'Password (hidden)'
    : prefix ? `${prefix.trimEnd()} … (sent with the prefix; start with ${PREFIX_BYPASS} to skip it once)`
    : `Type a command… (${sendHint})`;

  return (
    <div className={`input-bar ${session.echo ? '' : 'masked'}`}>
      <div className="input-grip" title="Drag to change the height of the command box" onMouseDown={startDrag} />
      {disconnected ? (
        <div className="input-offline">
          <span className="muted">Disconnected.</span>
          <button className="btn small" onClick={onReconnect}>Reconnect</button>
        </div>
      ) : (
        <div className="input-row">
          {prefix && (
            <span
              className={`input-prefix ${bypassing ? 'off' : ''}`}
              title={bypassing
                ? `Sent as typed, without "${prefix}" (the leading ${PREFIX_BYPASS} is removed)`
                : `Commands typed on this tab are sent as "${prefix}…". Start one with ${PREFIX_BYPASS} to send it without the prefix.`}
            >
              {prefix.trimEnd()}
            </span>
          )}
          <textarea
            ref={ref}
            className="input"
            value={value}
            rows={1}
            spellCheck={session.echo && (spellCheckInput || checkNow)}
            placeholder={placeholder}
            style={{ minHeight: `calc(${lines} * 1lh + ${BOX_PADDING}px)`, maxHeight: `calc(${MAX_LINES} * 1lh + ${BOX_PADDING}px)` }}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {session.echo && !spellCheckInput && (
            <button type="button" className={`btn small ghost input-check ${checkNow ? 'on' : ''}`} title="Spell-check what's in the box now (it turns off again when you send)" onClick={() => { setCheckNow(true); ref.current?.focus(); }}>🔤</button>
          )}
          {sendMode === 'button' && (
            <button type="button" className="btn primary input-send" title="Send this command (or press Ctrl+Enter)" onClick={() => { send(); ref.current?.focus(); }}>Send</button>
          )}
        </div>
      )}
    </div>
  );
}
