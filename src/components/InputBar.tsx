import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../lib/store';
import { activePrefix, PREFIX_BYPASS } from '../lib/channels';

interface Props {
  session: SessionState;
  onSend(text: string): void;
  onReconnect(): void;
}

export function InputBar({ session, onSend, onReconnect }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const histIdx = useRef<number | null>(null);   // null = not browsing history
  const draft = useRef('');

  useEffect(() => { ref.current?.focus(); }, []);

  // Keep the box to a sensible height: grows with content up to ~8 lines.
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const max = 8 * 22 + 16;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const send = () => {
    const text = value;
    onSend(text);
    setValue('');
    histIdx.current = null;
    draft.current = '';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const h = session.history;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
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
  const placeholder = !session.echo ? 'Password (hidden)'
    : prefix ? `${prefix.trimEnd()} … (sent with the prefix; start with ${PREFIX_BYPASS} to skip it once)`
    : 'Type a command… (Shift+Enter for a new line, ↑ for history)';

  return (
    <div className={`input-bar ${session.echo ? '' : 'masked'}`}>
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
            spellCheck={session.echo}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      )}
    </div>
  );
}
