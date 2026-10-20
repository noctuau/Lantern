import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { spanStyle } from '../lib/ansi';
import type { Line } from '../lib/store';
import type { Span } from '../lib/ansi';

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
const NONE: Span[] = [];

export function renderSpan(sp: Span, key: number) {
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

/** HH:MM for a line's timestamp (channel chat is read later, so when matters). */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const LineView = memo(function LineView({ line, showTime }: { line: Line; showTime?: boolean }) {
  return (
    <div className={`line kind-${line.kind} ${line.prompt ? 'prompt' : ''}`} data-ts={line.ts}>
      {showTime && <span className="ts" title={new Date(line.ts).toLocaleString()}>{fmtTime(line.ts)}</span>}
      {line.spans.length === 0 ? ' ' : line.spans.map(renderSpan)}
    </div>
  );
});

interface Props {
  lines: Line[];
  /** The unfinished line (the prompt). Only the main pane has one. */
  partial?: Span[];
  /** Prefix each line with its time (channel tabs). */
  timestamps?: boolean;
  /** Extra space (px) between lines, to space out chat in a channel pane. */
  lineGap?: number;
  /** Follow new output when already at the bottom (the scroll-lock setting). */
  autoScroll?: boolean;
  /** Hidden panes stay mounted so each keeps its own scroll position and scroll-lock. */
  visible?: boolean;
  emptyHint?: string;
}

/**
 * One scrollback: the main output or a channel tab. Scroll-lock ("pinned" to the bottom), the
 * missed-line count and the jump button belong to this pane alone.
 */
export function OutputPane({ lines, partial = NONE, timestamps = false, lineGap = 0, autoScroll = true, visible = true, emptyHint }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [missed, setMissed] = useState(0);
  const lastCount = useRef(lines.length);

  // Track whether the user has scrolled away from the bottom.
  const onScroll = () => {
    const el = ref.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== pinned) { setPinned(atBottom); if (atBottom) setMissed(0); }
  };

  // Snap to the bottom only when THIS pane gained content. Renders caused by other panes'
  // traffic must not touch the scroll position, or a scroll-up in a channel tab is undone
  // before the browser has even delivered the scroll event.
  const lastPartial = useRef(partial);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const added = lines.length - lastCount.current;
    const changed = added > 0 || partial !== lastPartial.current;
    lastCount.current = lines.length;
    lastPartial.current = partial;
    if (!changed) return;
    // Follow the latest only when auto-scroll is on and we are already at the bottom.
    if (autoScroll && pinned) { if (visible) el.scrollTop = el.scrollHeight; }
    else if (added > 0) setMissed((m) => m + added);
  });

  // Wheel up unpins at once, before the scroll event arrives, so an incoming line cannot
  // snap the pane back down in the same frame.
  const onWheel = (e: React.WheelEvent) => { if (e.deltaY < 0 && pinned) setPinned(false); };

  // Coming back into view: a pinned pane (display:none has no height) snaps to its latest line.
  useLayoutEffect(() => {
    const el = ref.current;
    if (visible && el) { if (pinned) el.scrollTop = el.scrollHeight; el.focus(); }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (visible) ref.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = () => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; setPinned(true); setMissed(0); } };

  return (
    <div className={`output-wrap ${visible ? '' : 'hidden'}`}>
      <div className="output" ref={ref} onScroll={onScroll} onWheel={onWheel} tabIndex={-1}
        style={lineGap ? ({ '--line-gap': `${lineGap}px` } as CSSProperties) : undefined}>
        {lines.length === 0 && emptyHint && <div className="line output-empty">{emptyHint}</div>}
        {lines.map((l) => <LineView key={l.id} line={l} showTime={timestamps} />)}
        {partial.length > 0 && (
          <div className="line kind-mud partial">{partial.map(renderSpan)}</div>
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
