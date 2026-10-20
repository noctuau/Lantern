/**
 * Colour chooser: a dropdown listing the 16 ANSI palette colours with swatches,
 * plus a custom entry backed by the OS colour picker and a hex field.
 * Values are '0'..'15' for palette colours or a CSS colour string; null = none.
 */
import { useEffect, useRef, useState } from 'react';

export const ANSI_NAMES = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
  'Grey', 'Bright red', 'Bright green', 'Bright yellow', 'Bright blue', 'Bright magenta', 'Bright cyan', 'Bright white'];

export const colourCss = (c: string) => (/^\d+$/.test(c) ? `var(--ansi-${c})` : c);

export function colourLabel(c: string | null, none = 'No colour change') {
  if (c === null) return none;
  return /^\d+$/.test(c) ? (ANSI_NAMES[Number(c)] ?? c) : c;
}

/** Resolve a colour value to #rrggbb for <input type="color">. */
function toHex(c: string | null): string {
  if (!c) return '#e8a94b';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const el = document.createElement('span');
  el.style.color = colourCss(c);
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color;
  el.remove();
  const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#e8a94b';
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

interface Props {
  value: string | null;
  onChange(v: string | null): void;
  /** Offer a "none" entry (default true). */
  allowNone?: boolean;
  noneLabel?: string;
  /** Sample text drawn in the chosen colour beside the control. */
  sample?: string;
}

export function ColourPicker({ value, onChange, allowNone = true, noneLabel = 'No colour change', sample }: Props) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(() => toHex(value));
  const wrap = useRef<HTMLDivElement>(null);
  const isCustom = value !== null && !/^\d+$/.test(value);

  useEffect(() => { if (!isCustom) setHex(toHex(value)); }, [value, isCustom]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const pick = (v: string | null) => { onChange(v); setOpen(false); };

  return (
    <div className="colour-picker" ref={wrap}>
      <button type="button" className="colour-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="swatch" style={{ background: value === null ? 'transparent' : colourCss(value), borderStyle: value === null ? 'dashed' : 'solid' }} />
        <span className="colour-name">{colourLabel(value, noneLabel)}</span>
        <span className="colour-caret">▾</span>
      </button>
      {sample && (
        <span className="colour-sample" style={value === null ? undefined : { color: colourCss(value) }}>{sample}</span>
      )}
      {open && (
        <div className="colour-menu" role="listbox">
          {allowNone && (
            <button type="button" className={`colour-row ${value === null ? 'active' : ''}`} onClick={() => pick(null)}>
              <span className="swatch" style={{ background: 'transparent', borderStyle: 'dashed' }} />{noneLabel}
            </button>
          )}
          <div className="colour-grid">
            {ANSI_NAMES.map((n, i) => (
              <button type="button" key={i} className={`colour-row ${value === String(i) ? 'active' : ''}`} onClick={() => pick(String(i))} title={n}>
                <span className="swatch" style={{ background: `var(--ansi-${i})` }} />{n}
              </button>
            ))}
          </div>
          <div className={`colour-custom ${isCustom ? 'active' : ''}`}>
            <input
              type="color"
              value={hex}
              title="Pick any colour"
              onChange={(e) => { setHex(e.target.value); onChange(e.target.value); }}
            />
            <input
              className="mono"
              value={isCustom ? value : hex}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value;
                setHex(/^#[0-9a-f]{6}$/i.test(v) ? v : hex);
                if (/^#[0-9a-f]{6}$/i.test(v) || /^[a-z]+$/i.test(v)) onChange(v);
              }}
              placeholder="#rrggbb"
            />
            <span className="muted small">Custom</span>
          </div>
        </div>
      )}
    </div>
  );
}
