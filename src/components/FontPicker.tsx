/**
 * Font chooser: a dropdown over the installed font list, each entry drawn in
 * its own face, with a filter box. Typing a name that is not in the list is
 * allowed too (fonts the list cannot see still work if they are installed).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { isMonospace } from '../lib/settings';

interface Props {
  value: string;
  fonts: string[];
  onChange(v: string): void;
}

export function FontPicker({ value, fonts, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [monoOnly, setMonoOnly] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    let all = fonts.includes(value) || !value ? fonts : [value, ...fonts];
    if (monoOnly) all = all.filter((n) => n === value || isMonospace(n));
    const f = filter.trim().toLowerCase();
    return f ? all.filter((n) => n.toLowerCase().includes(f)) : all;
  }, [fonts, filter, value, monoOnly]);

  useEffect(() => {
    if (!open) return;
    setFilter('');
    requestAnimationFrame(() => box.current?.focus());
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  // Keep the chosen font in view when the menu opens.
  useEffect(() => {
    if (!open) return;
    const el = wrap.current?.querySelector('.font-row.active') as HTMLElement | null;
    el?.scrollIntoView({ block: 'center' });
  }, [open]);

  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div className="font-picker" ref={wrap}>
      <button type="button" className="font-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="font-name" style={{ fontFamily: `"${value}"` }}>{value || 'Default'}</span>
        <span className="colour-caret">▾</span>
      </button>
      {open && (
        <div className="font-menu">
          <input
            ref={box}
            className="font-filter"
            value={filter}
            placeholder={`Search ${fonts.length} fonts, or type a name`}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); pick(list[0] ?? filter.trim()); }
            }}
          />
          <label className="check inline font-mono-toggle" title="Fixed-pitch fonts keep ASCII maps and tables aligned">
            <input type="checkbox" checked={monoOnly} onChange={(e) => setMonoOnly(e.target.checked)} /> Monospace only
          </label>
          <div className="font-list" role="listbox">
            {list.map((n) => (
              <button type="button" key={n} className={`font-row ${n === value ? 'active' : ''}`} onClick={() => pick(n)}>
                <span className="font-row-name">{n}</span>
                <span className="font-row-sample" style={{ fontFamily: `"${n}"` }}>Quick fox 0O 1lI</span>
              </button>
            ))}
            {list.length === 0 && filter.trim() && (
              <button type="button" className="font-row" onClick={() => pick(filter.trim())}>
                Use "{filter.trim()}" anyway
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
