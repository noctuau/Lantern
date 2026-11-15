import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { spanStyle } from '../lib/ansi';
import type { Line } from '../lib/store';
import type { Span } from '../lib/ansi';
import { FindBar } from './FindBar';
import { findMatches, queryIsValid, type FindMatch } from '../lib/search';

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
const NONE: Span[] = [];
const NO_MATCHES: FindMatch[] = [];

/** Turn any http(s) URLs in a plain string into clickable links, leaving the rest as text. */
function linkify(text: string): ReactNode {
  URL_RE.lastIndex = 0;
  if (!URL_RE.test(text)) return text;
  URL_RE.lastIndex = 0;
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    i % 2 === 1
      ? <a key={i} href={p} className="link" onClick={(e) => { e.preventDefault(); window.lantern.app.openExternal(p); }}>{p}</a>
      : p,
  );
}

export function renderSpan(sp: Span, key: number) {
  return <span key={key} style={spanStyle(sp.style)}>{linkify(sp.text)}</span>;
}

/**
 * Render a line's spans with the find hits wrapped in <mark>. `ranges` are [start, end) offsets into
 * the line's full text (sorted, non-overlapping — as findMatches returns them per line); `current`
 * is the one range to flag as the active match. A hit that crosses a colour boundary is split at the
 * span edge so each piece keeps its own colour under the highlight.
 */
function renderSpansMarked(spans: Span[], ranges: [number, number][], current: [number, number] | null): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  let pos = 0; // running offset into the full line text
  for (const sp of spans) {
    const style = spanStyle(sp.style);
    const spStart = pos;
    const spEnd = pos + sp.text.length;
    let cursor = spStart;
    for (const [rs, re] of ranges) {
      if (re <= spStart) continue;      // range ends before this span
      if (rs >= spEnd) break;           // ranges are sorted: nothing further touches this span
      const a = Math.max(rs, spStart);
      const b = Math.min(re, spEnd);
      if (a > cursor) out.push(<span key={key++} style={style}>{linkify(sp.text.slice(cursor - spStart, a - spStart))}</span>);
      const isCur = !!current && rs === current[0] && re === current[1];
      out.push(<mark key={key++} className={`find-mark${isCur ? ' current' : ''}`} style={style}>{sp.text.slice(a - spStart, b - spStart)}</mark>);
      cursor = b;
    }
    if (cursor < spEnd) out.push(<span key={key++} style={style}>{linkify(sp.text.slice(cursor - spStart))}</span>);
    pos = spEnd;
  }
  return out;
}

/** HH:MM for a line's timestamp (channel chat is read later, so when matters). */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const LineView = memo(function LineView({ line, showTime }: { line: Line; showTime?: boolean }) {
  // Hover any line to see when it arrived (like MUSHclient), even when inline timestamps are off.
  const when = new Date(line.ts).toLocaleString();
  return (
    <div className={`line kind-${line.kind} ${line.prompt ? 'prompt' : ''}`} data-ts={line.ts} data-id={line.id} title={when}>
      {showTime && <span className="ts" title={when}>{fmtTime(line.ts)}</span>}
      {line.spans.length === 0 ? ' ' : line.spans.map(renderSpan)}
    </div>
  );
});

/** A line that has find hits in it. Not memoized by id (the current match moves as you step), but
 *  only the handful of matching lines take this path — the rest keep the per-id element cache. */
function MarkedLine({ line, showTime, ranges, current }: { line: Line; showTime?: boolean; ranges: [number, number][]; current: [number, number] | null }) {
  const when = new Date(line.ts).toLocaleString();
  return (
    <div className={`line kind-${line.kind} ${line.prompt ? 'prompt' : ''}`} data-ts={line.ts} data-id={line.id} title={when}>
      {showTime && <span className="ts" title={when}>{fmtTime(line.ts)}</span>}
      {renderSpansMarked(line.spans, ranges, current)}
    </div>
  );
}

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
  /** Floated at the bottom right of the pane, above the jump button when that is showing (the unread pills). */
  extras?: ReactNode;
  /** Called after a plain click in the pane (no text selected) so focus can return to the command box. */
  onReturnFocus?(): void;
  /** Bumped by App (Ctrl+F, the ☰ menu, the right-click menu) to open the find bar in the visible
   *  pane. `query`, when given, pre-fills the box (e.g. the selected text from a right-click). */
  openFind?: { tick: number; query?: string };
}

/**
 * One scrollback: the main output or a channel tab. Scroll-lock ("pinned" to the bottom), the
 * missed-line count and the jump button belong to this pane alone.
 */
export function OutputPane({ lines, partial = NONE, timestamps = false, lineGap = 0, autoScroll = true, visible = true, emptyHint, extras, onReturnFocus, openFind }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // "pinned" (at the bottom, following) is a ref so the content effect reads it without a stale
  // closure and without re-rendering the big list; the jump button uses a separate state.
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [missed, setMissed] = useState(0);
  const lastCount = useRef(lines.length);
  // A hidden pane (a channel tab you're not looking at) is display:none, so the sentinel observer
  // below reports it as off-screen and would flip `pinned` to false — then switching to that tab
  // wouldn't snap to the bottom. Freeze the at-bottom tracking while hidden by reading this each
  // callback, so it only ever reacts to real scrolling in a pane you can actually see.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // Glue to the true bottom with scrollTop (not scrollIntoView on the sentinel): during fast output
  // the sentinel's target is computed from content-visibility's *estimated* line heights and can
  // land a little short, which then reads as "scrolled up". scrollHeight is the real max, and the
  // ResizeObserver below re-asserts it after the browser corrects those estimates.
  const toBottom = () => { const el = ref.current; if (el && visible) el.scrollTop = el.scrollHeight; };

  // Track "at the bottom" with an IntersectionObserver on a sentinel. This is robust against the
  // content-visibility size estimates that otherwise made follow-at-bottom jumpy.
  useEffect(() => {
    const el = ref.current, b = bottom.current;
    if (!el || !b) return;
    const io = new IntersectionObserver((entries) => {
      if (!visibleRef.current) return; // ignore while hidden: display:none reads as "scrolled away"
      const atBottom = entries[entries.length - 1].isIntersecting;
      pinned.current = atBottom;
      setShowJump(!atBottom);
      if (atBottom) setMissed(0);
    }, { root: el, threshold: 0, rootMargin: '0px 0px 48px 0px' });
    io.observe(b);
    return () => io.disconnect();
  }, []);

  // Keep the view pinned to the bottom while following, even as content-visibility revises off-screen
  // line heights *after* paint — which otherwise leaves the pane a touch short of the end, so the
  // sentinel observer decides we've scrolled up and auto-scroll quietly stops (the "won't stay at the
  // bottom" bug). A ResizeObserver on the content re-asserts the bottom whenever its height changes,
  // so a fast flood can't drift the pane off the end. It only moves the scroll when already pinned, so
  // a reader who has scrolled up is never yanked down; setting scrollTop doesn't resize, so no loop.
  useEffect(() => {
    const el = ref.current, innerEl = inner.current;
    if (!el || !innerEl) return;
    const ro = new ResizeObserver(() => { if (pinned.current && autoScroll && visible) el.scrollTop = el.scrollHeight; });
    ro.observe(innerEl);
    return () => ro.disconnect();
  }, [autoScroll, visible]);

  // Follow the latest only when auto-scroll is on and we are already at the bottom.
  const lastPartial = useRef(partial);
  useLayoutEffect(() => {
    const added = lines.length - lastCount.current;
    const changed = added > 0 || partial !== lastPartial.current;
    lastCount.current = lines.length;
    lastPartial.current = partial;
    if (!changed) return;
    if (autoScroll && pinned.current) toBottom();
    else if (added > 0 && !pinned.current) setMissed((m) => m + added);
  });

  // Wheel up unpins at once so an incoming line in the same frame cannot snap the pane back down.
  const onWheel = (e: React.WheelEvent) => { if (e.deltaY < 0) pinned.current = false; };

  // A plain click in the output (nothing selected) returns focus to the command box, so reading or
  // clicking the game text never leaves you unable to type. A drag that selects text keeps the
  // selection (and focus) so it can be copied; the next keystroke brings focus back (see InputBar).
  const onMouseUp = () => { const sel = window.getSelection(); if (!sel || sel.isCollapsed) onReturnFocus?.(); };

  // Coming back into view: a pinned pane (display:none has no height) snaps to its latest line. The
  // pane never takes keyboard focus itself (that belongs to the command box); it scrolls by wheel.
  useLayoutEffect(() => { if (visible && pinned.current) toBottom(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) toBottom(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = () => { pinned.current = true; setMissed(0); toBottom(); };

  /* ---------- find in output ---------- */
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [curState, setCurState] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);

  // Open (and focus) on a bump from App — but only in the pane that's actually on screen, so the
  // single Ctrl+F reaches the main pane or whichever channel tab you're reading, not all of them.
  const lastFindTick = useRef(openFind?.tick ?? 0);
  useEffect(() => {
    if (!openFind || openFind.tick === lastFindTick.current) return;
    lastFindTick.current = openFind.tick;
    if (!visible) return;
    setFindOpen(true);
    if (openFind.query != null) setQuery(openFind.query);
    requestAnimationFrame(() => { const el = findInput.current; if (el) { el.focus(); el.select(); } });
  }, [openFind, visible]);

  const finding = findOpen && query !== '';
  const invalidRe = regex && query !== '' && !queryIsValid(query, { regex, caseSensitive });
  const matches = useMemo(
    () => (finding ? findMatches(lines.map((l) => ({ id: l.id, text: l.spans.map((sp) => sp.text).join('') })), query, { regex, caseSensitive }) : NO_MATCHES),
    [finding, lines, query, regex, caseSensitive],
  );
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  // Hits grouped onto their line, for the render pass.
  const rangesByLine = useMemo(() => {
    const m = new Map<number, [number, number][]>();
    for (const x of matches) { const a = m.get(x.lineId); if (a) a.push([x.start, x.end]); else m.set(x.lineId, [[x.start, x.end]]); }
    return m;
  }, [matches]);
  // The current match, clamped so it stays valid as hits appear or scroll out of the buffer.
  const cur = matches.length === 0 ? -1 : Math.min(Math.max(curState, 0), matches.length - 1);
  const curMatch = cur >= 0 ? matches[cur] : null;
  const curRange: [number, number] | null = curMatch ? [curMatch.start, curMatch.end] : null;

  // A new query (or toggle) jumps to the *last* hit — the most recent output, where you usually are.
  const findSig = `${query}\u0000${regex ? 1 : 0}\u0000${caseSensitive ? 1 : 0}`;
  useEffect(() => { setCurState(matchesRef.current.length - 1); }, [findSig]);

  const step = (d: 1 | -1) => {
    const len = matchesRef.current.length;
    if (!len) return;
    setCurState((c) => { const base = Math.min(Math.max(c, 0), len - 1); return (base + d + len) % len; });
  };
  const closeFind = () => { setFindOpen(false); onReturnFocus?.(); };

  // Bring the current match to the middle of the pane, and stop following the bottom while searching
  // (so an incoming line can't yank you off the hit you're reading).
  useEffect(() => {
    if (!finding || cur < 0) return;
    pinned.current = false;
    const el = ref.current?.querySelector('.find-mark.current');
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [finding, cur]);

  // A committed line never changes once it is on screen, so its rendered element is cached by id and
  // handed back unchanged on every render. Fast output re-renders this pane once per animation frame;
  // reusing the same element lets React bail out per line instead of rebuilding (and garbage-
  // collecting) the whole scrollback each frame. That churn — not the browser's paint, which
  // content-visibility already skips — is what made the command box lag during combat spam. The cache
  // is rebuilt from the current lines each render, so evicted lines fall out of it (no leak), and it
  // is dropped when the timestamp prefix toggles (the only thing that changes a line's element).
  const cache = useRef(new Map<number, ReactElement>());
  const cacheTime = useRef(timestamps);
  if (cacheTime.current !== timestamps) { cache.current.clear(); cacheTime.current = timestamps; }
  const prevCache = cache.current;
  const nextCache = new Map<number, ReactElement>();
  const curLineId = curMatch?.lineId ?? -1;
  const rendered = lines.map((l) => {
    // A line with hits renders fresh with its <mark>s (and bypasses the cache); everything else keeps
    // the cached element, so highlighting never costs the live-output fast path its per-line bail-out.
    const r = rangesByLine.get(l.id);
    if (r) return <MarkedLine key={l.id} line={l} showTime={timestamps} ranges={r} current={l.id === curLineId ? curRange : null} />;
    let el = prevCache.get(l.id);
    if (!el) el = <LineView key={l.id} line={l} showTime={timestamps} />;
    nextCache.set(l.id, el);
    return el;
  });
  cache.current = nextCache;

  return (
    <div className={`output-wrap ${visible ? '' : 'hidden'}`}>
      {findOpen && (
        <FindBar
          query={query} onQuery={setQuery}
          regex={regex} onToggleRegex={() => setRegex((v) => !v)}
          caseSensitive={caseSensitive} onToggleCase={() => setCaseSensitive((v) => !v)}
          count={matches.length} current={Math.max(cur, 0)} invalid={invalidRe}
          onNext={() => step(1)} onPrev={() => step(-1)} onClose={closeFind}
          inputRef={findInput}
        />
      )}
      <div className="output" ref={ref} onWheel={onWheel} onMouseUp={onMouseUp}
        style={lineGap ? ({ '--line-gap': `${lineGap}px` } as CSSProperties) : undefined}>
        <div className="output-inner" ref={inner}>
          {lines.length === 0 && emptyHint && <div className="line output-empty">{emptyHint}</div>}
          {rendered}
          {partial.length > 0 && (
            <div className="line kind-mud partial">{partial.map(renderSpan)}</div>
          )}
          <div ref={bottom} className="output-bottom" aria-hidden="true" />
        </div>
      </div>
      {(showJump || extras) && (
        <div className="float-stack">
          {extras}
          {showJump && (
            <button className="jump" onClick={jump}>
              ↓ {missed > 0 ? `${missed} new line${missed === 1 ? '' : 's'}` : 'Jump to latest'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
