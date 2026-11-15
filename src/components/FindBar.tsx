import type { RefObject } from 'react';

/**
 * The find-in-output bar: a small overlay at the top-right of the active pane. It owns no state —
 * OutputPane holds the query, the toggles and the current-match index and feeds them back here.
 * Enter / Shift+Enter step the match; Escape closes (and returns focus to the command box).
 */
export interface FindBarProps {
  query: string;
  onQuery(q: string): void;
  regex: boolean;
  onToggleRegex(): void;
  caseSensitive: boolean;
  onToggleCase(): void;
  /** Total matches, and the 0-based index of the current one. */
  count: number;
  current: number;
  /** The regex toggle is on and the pattern won't compile. */
  invalid: boolean;
  onNext(): void;
  onPrev(): void;
  onClose(): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function FindBar(p: FindBarProps) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) p.onPrev(); else p.onNext(); }
    else if (e.key === 'Escape') { e.preventDefault(); p.onClose(); }
  };

  const status = p.invalid ? 'Bad pattern'
    : p.query === '' ? ''
    : p.count === 0 ? 'No results'
    : `${p.current + 1} / ${p.count}`;
  const statusBad = p.query !== '' && (p.invalid || p.count === 0);

  return (
    <div className="find-bar" role="search" onKeyDown={onKeyDown}>
      <input
        ref={p.inputRef}
        className={`find-input ${p.invalid ? 'invalid' : ''}`}
        value={p.query}
        placeholder="Find in output"
        spellCheck={false}
        aria-label="Find in output"
        onChange={(e) => p.onQuery(e.target.value)}
      />
      <span className={`find-count ${statusBad ? 'none' : ''}`}>{status}</span>
      <button type="button" className={`find-btn toggle ${p.regex ? 'on' : ''}`} title="Regular expression" aria-pressed={p.regex} onClick={p.onToggleRegex}>.*</button>
      <button type="button" className={`find-btn toggle ${p.caseSensitive ? 'on' : ''}`} title="Match case" aria-pressed={p.caseSensitive} onClick={p.onToggleCase}>Aa</button>
      <button type="button" className="find-btn" title="Previous match (Shift+Enter)" disabled={p.count === 0} onClick={p.onPrev}>↑</button>
      <button type="button" className="find-btn" title="Next match (Enter)" disabled={p.count === 0} onClick={p.onNext}>↓</button>
      <button type="button" className="find-btn" title="Close (Esc)" onClick={p.onClose}>✕</button>
    </div>
  );
}
