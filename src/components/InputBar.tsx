import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../lib/store';

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

  return (
    <div className={`input-bar ${session.echo ? '' : 'masked'}`}>
      {disconnected ? (
        <div className="input-offline">
          <span className="muted">Disconnected.</span>
          <button className="btn small" onClick={onReconnect}>Reconnect</button>
        </div>
      ) : (
        <textarea
          ref={ref}
          className="input"
          value={value}
          rows={1}
          spellCheck={session.echo}
          placeholder={session.echo ? 'Type a command… (Shift+Enter for a new line, ↑ for history)' : 'Password (hidden)'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  );
}
