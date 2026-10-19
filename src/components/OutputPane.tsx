import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { spanStyle } from '../lib/ansi';
import type { Line, SessionState } from '../lib/store';
import type { Span } from '../lib/ansi';

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

function renderSpan(sp: Span, key: number) {
  const style = spanStyle(sp.style);
  if (!URL_RE.test(sp.text)) return <span key={key} style={style}>{sp.text}</span>;
  URL_RE.lastIndex = 0;
  const parts = sp.text.split(URL_RE);
  return (
    <span key={key} style={style}>
      {parts.map((p, i) =>
        i % 2 === 1
          ? <a key={i} href={p} className="link" onClick={(e) => { e.preventDefault(); window.lantern.app.openExternal(p); }}>{p}</a>
          : p,
      )}
    </span>
  );
}

const LineView = memo(function LineView({ line }: { line: Line }) {
  return (
    <div className={`line kind-${line.kind} ${line.prompt ? 'prompt' : ''}`} data-ts={line.ts}>
      {line.spans.length === 0 ? ' ' : line.spans.map(renderSpan)}
    </div>
  );
});

export function OutputPane({ session }: { session: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [missed, setMissed] = useState(0);
  const lastCount = useRef(session.lines.length);

  // Track whether the user has scrolled away from the bottom.
  const onScroll = () => {
    const el = ref.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== pinned) { setPinned(atBottom); if (atBottom) setMissed(0); }
  };

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (pinned) el.scrollTop = el.scrollHeight;
    else {
      const added = session.lines.length - lastCount.current;
      if (added > 0) setMissed((m) => m + added);
    }
    lastCount.current = session.lines.length;
  });

  useEffect(() => { ref.current?.focus(); }, []);

  const jump = () => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; setPinned(true); setMissed(0); } };

  return (
    <div className="output-wrap">
      <div className="output" ref={ref} onScroll={onScroll} tabIndex={-1}>
        {session.lines.map((l) => <LineView key={l.id} line={l} />)}
        {session.partial.length > 0 && (
          <div className="line kind-mud partial">{session.partial.map(renderSpan)}</div>
        )}
      </div>
      {!pinned && (
        <button className="jump" onClick={jump}>
          ↓ {missed > 0 ? `${missed} new line${missed === 1 ? '' : 's'}` : 'Jump to latest'}
        </button>
      )}
    </div>
  );
}
