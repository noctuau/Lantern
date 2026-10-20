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
  /** Text to pre-fill (e.g. the current selection in the command box or output). */
  initialText?: string;
}

const SWATCHES = Array.from({ length: 240 }, (_, i) => i + 16); // xterm 16-255, the colour cube + greys

export function ColourComposer({ onInsert, onClose, initialText }: Props) {
  const [text, setText] = useState(initialText ?? '');
  const [codes, setCodes] = useState(GRADIENT_PRESETS[0].codes);
  // The preset the codes currently match, so the dropdown shows what's selected; '' = Custom.
  const [presetName, setPresetName] = useState(GRADIENT_PRESETS[0].name);
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

  // Any code change re-syncs the dropdown: if the codes match a preset, show it, else "Custom".
  const applyCodes = (c: string) => {
    setCodes(c);
    const hit = GRADIENT_PRESETS.find((p) => p.codes === c.trim());
    setPresetName(hit ? hit.name : '');
  };
  const applyPreset = (name: string) => {
    const p = GRADIENT_PRESETS.find((x) => x.name === name);
    if (!p) { setPresetName(''); return; }
    setPresetName(p.name);
    setCodes(p.codes);
  };
  // Step up/down the preset list; from "Custom" the down arrow starts at the top, up at the bottom.
  const stepPreset = (dir: 1 | -1) => {
    const n = GRADIENT_PRESETS.length;
    const i = GRADIENT_PRESETS.findIndex((p) => p.name === presetName);
    const next = i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
    applyPreset(GRADIENT_PRESETS[next].name);
  };
  const addCode = (nn: number) => applyCodes(`${codes.trim()} ${String(nn).padStart(3, '0')}`.trim());

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
            <div className="preset-row">
              <select className="grow" value={presetName} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Custom</option>
                {GRADIENT_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <button type="button" className="btn small ghost step" title="Previous preset" onClick={() => stepPreset(-1)}>▲</button>
              <button type="button" className="btn small ghost step" title="Next preset" onClick={() => stepPreset(1)}>▼</button>
            </div>
          </label>
          <label className="check inline"><input type="checkbox" checked={bothways} onChange={(e) => setBothways(e.target.checked)} /> Fade both ways</label>
          <label className="check inline"><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Reverse</label>
          <label className="check inline"><input type="checkbox" checked={random} onChange={(e) => setRandom(e.target.checked)} /> Randomise</label>
        </div>

        <label>Colour codes (xterm 0-255, space-separated)
          <div className="row">
            <input className="mono grow" value={codes} onChange={(e) => applyCodes(e.target.value)} spellCheck={false} />
            <button type="button" className="btn small ghost" onClick={() => applyCodes('')}>Clear</button>
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
