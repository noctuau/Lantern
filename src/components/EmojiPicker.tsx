import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_LIST, searchEmoji, nameForChar, type EmojiEntry } from '../lib/emoji';

interface Props {
  /** Drop this emoji into the command box. The picker stays open so several can be picked. */
  onPick(char: string): void;
  /** Close the popover (Esc, or a click outside it). */
  onClose(): void;
}

const FREQ_KEY = 'lantern.emoji.freq';
const FREQ_SHOWN = 24;

type Freq = { c: string; n: number };

function loadFreq(): Freq[] {
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((f) => f && typeof f.c === 'string' && typeof f.n === 'number') : [];
  } catch { return []; }
}

function saveFreq(f: Freq[]) {
  try { localStorage.setItem(FREQ_KEY, JSON.stringify(f)); } catch { /* storage off/full — recents just won't persist */ }
}

export function EmojiPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [freq, setFreq] = useState<Freq[]>(loadFreq);
  const [hover, setHover] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  // Close on Escape, or a mousedown anywhere outside this popover and its toggle button (both live
  // inside .emoji-pick-wrap, so a click on the 😀 button is left to toggle itself, not double-close).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.emoji-pick-wrap')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const recents: EmojiEntry[] = useMemo(() => {
    const ranked = [...freq].sort((a, b) => b.n - a.n).slice(0, FREQ_SHOWN);
    return ranked.map((f) => {
      const name = nameForChar(f.c);
      return name ? { char: f.c, name, aliases: [] } : { char: f.c, name: f.c, aliases: [] };
    });
  }, [freq]);

  const results = useMemo(() => searchEmoji(query), [query]);
  const searching = query.trim() !== '';

  const pick = (char: string) => {
    setFreq((prev) => {
      const next = prev.map((f) => ({ ...f }));
      const hit = next.find((f) => f.c === char);
      if (hit) hit.n += 1; else next.push({ c: char, n: 1 });
      saveFreq(next);
      return next;
    });
    onPick(char);
  };

  const hoverName = hover ? nameForChar(hover) : null;

  const cell = (e: EmojiEntry) => (
    <button
      type="button"
      key={e.char + e.name}
      className="emoji-cell"
      title={`:${e.name}:`}
      onMouseEnter={() => setHover(e.char)}
      onFocus={() => setHover(e.char)}
      onClick={() => pick(e.char)}
    >{e.char}</button>
  );

  return (
    <div className="emoji-picker" ref={rootRef} role="dialog" aria-label="Emoji picker">
      <div className="emoji-search">
        <input
          ref={searchRef}
          type="text"
          value={query}
          placeholder="Search emoji…"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="emoji-scroll">
        {searching ? (
          results.length ? (
            <div className="emoji-grid">{results.map(cell)}</div>
          ) : (
            <div className="emoji-empty">No emoji for “{query.trim()}”.</div>
          )
        ) : (
          <>
            {recents.length > 0 && (
              <>
                <div className="emoji-head">Frequently used</div>
                <div className="emoji-grid">{recents.map(cell)}</div>
              </>
            )}
            <div className="emoji-head">All</div>
            <div className="emoji-grid">{EMOJI_LIST.map(cell)}</div>
          </>
        )}
      </div>
      <div className="emoji-foot">
        {hover ? <><span className="emoji-foot-char">{hover}</span> <code>:{hoverName}:</code></> : <span className="muted">Pick an emoji — it drops in at your cursor.</span>}
      </div>
    </div>
  );
}
