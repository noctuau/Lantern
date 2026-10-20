/**
 * Colour composer: build a gradient (or hand-pick) xterm colours across a line of text and emit
 * the game's backtick codes, with a live preview rendered by Lantern's own colours. Insert it
 * straight into the command box, or copy it. Based on Noctua's "MUD Gradient Maker".
 */
import { useMemo, useState } from 'react';
import { GRADIENT_PRESETS, makeGradient, parseBacktick, parseCodes, xtermHex } from '../lib/gradient';

interface Props {
  onInsert(text: string): void;
  onClose(): void;
}

const SWATCHES = Array.from({ length: 240 }, (_, i) => i + 16); // xterm 16-255, the colour cube + greys

export function ColourComposer({ onInsert, onClose }: Props) {
  const [text, setText] = useState('');
  const [codes, setCodes] = useState(GRADIENT_PRESETS[0].codes);
  const [bothways, setBothways] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [random, setRandom] = useState(false);
  const [copied, setCopied] = useState(false);

  const output = useMemo(
    () => makeGradient(text, codes, { bothways, reverse, random }),
    [text, codes, bothways, reverse, random],
  );
  const preview = useMemo(() => parseBacktick(output), [output]);
  const codeCount = parseCodes(codes).length;

  const addCode = (n: number) => setCodes((c) => `${c.trim()} ${String(n).padStart(3, '0')}`.trim());

  const copy = async () => {
    try { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal composer">
        <button type="button" className="modal-x" title="Close" onClick={onClose}>×</button>
        <h2>Colour composer</h2>

        <label>Text to colour
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the pose or line you want to colour…" />
        </label>

        <div className="row">
          <label className="grow">Preset
            <select value="" onChange={(e) => { if (e.target.value) setCodes(e.target.value); }}>
              <option value="">Pick a gradient…</option>
              {GRADIENT_PRESETS.map((p) => <option key={p.name} value={p.codes}>{p.name}</option>)}
            </select>
          </label>
          <label className="check inline"><input type="checkbox" checked={bothways} onChange={(e) => setBothways(e.target.checked)} /> Fade both ways</label>
          <label className="check inline"><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Reverse</label>
          <label className="check inline"><input type="checkbox" checked={random} onChange={(e) => setRandom(e.target.checked)} /> Randomise</label>
        </div>

        <label>Colour codes (xterm 0-255, space-separated)
          <div className="row">
            <input className="mono grow" value={codes} onChange={(e) => setCodes(e.target.value)} spellCheck={false} />
            <button type="button" className="btn small ghost" onClick={() => setCodes('')}>Clear</button>
          </div>
        </label>
        <details className="composer-swatches">
          <summary className="hint">Pick colours by hand ({codeCount} in use) — click to add</summary>
          <div className="composer-grid">
            {SWATCHES.map((n) => (
              <button type="button" key={n} className="composer-sw" title={`xterm ${n}`} style={{ background: xtermHex(n) }} onClick={() => addCode(n)} />
            ))}
          </div>
        </details>

        <div className="composer-preview-wrap">
          <div className="hint">Preview (how it looks in the room)</div>
          <div className="composer-preview">
            {text.trim() === '' ? <span className="muted">Your coloured text appears here.</span>
              : preview.map((s, i) => <span key={i} style={s.hex ? { color: s.hex } : undefined}>{s.text}</span>)}
          </div>
        </div>

        <label>Code to send
          <textarea className="mono" rows={2} readOnly value={output} onFocus={(e) => e.currentTarget.select()} />
        </label>

        <div className="modal-actions">
          <span className="muted small">{copied ? 'Copied.' : `${text.length} chars · ${codeCount} colours`}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={copy} disabled={!output}>Copy</button>
          <button type="button" className="btn primary" disabled={!output} onClick={() => { onInsert(output); onClose(); }}>Insert into command box</button>
        </div>
      </div>
    </div>
  );
}
