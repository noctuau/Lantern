/**
 * Colour composer: build a gradient (or hand-pick colours) across a line of text and emit the
 * game's backtick codes, with a live preview rendered by Lantern's own colours. Two colour systems:
 * Xterm (`NNN, 0-255) and HTML truecolour (`#rrggbb). Insert it straight into the command box, or
 * copy it. Based on Noctua's "MUD Gradient Maker".
 */
import { useEffect, useMemo, useState } from 'react';
import { makeGradient, parseBacktick, parseCodes, xtermHex, blendHex, blendMany, type GradientPreset, type ColourMode } from '../lib/gradient';
import { loadRecents, pushRecent } from '../lib/recents';

interface Props {
  onInsert(text: string): void;
  onClose(): void;
  /** Text to pre-fill (e.g. the current selection in the command box or output). */
  initialText?: string;
  /** The xterm presets to offer, in order (Settings › Presets). */
  presets: GradientPreset[];
  /** The HTML (truecolour) presets to offer, in order (Settings › Presets). */
  htmlPresets: GradientPreset[];
  /** "Save as preset": add the current colours under a name (replacing one of the same name) in that mode's list. */
  onSavePreset?(p: GradientPreset, mode: ColourMode): void;
  /** Toggle the favourite (★) flag on a named preset in that mode's list. */
  onToggleFavourite?(name: string, mode: ColourMode): void;
}

const SWATCHES = Array.from({ length: 240 }, (_, i) => i + 16); // xterm 16-255, the colour cube + greys
const BLEND_STEPS = 8;    // colours in a quick two-colour A→B blend
const SMOOTH_PER = 6;     // colours blended between each adjacent pair when smoothing all stops

export function ColourComposer({ onInsert, onClose, initialText, presets, htmlPresets, onSavePreset, onToggleFavourite }: Props) {
  const [mode, setMode] = useState<ColourMode>('xterm');
  const [recents] = useState(loadRecents);
  const activePresets = mode === 'html' ? htmlPresets : presets;
  const [text, setText] = useState(initialText ?? '');
  const [codes, setCodes] = useState(presets[0]?.codes ?? '');
  // The preset the codes currently match, so the dropdown shows what's selected; '' = Custom.
  const [presetName, setPresetName] = useState(presets[0]?.name ?? '');
  const [bothways, setBothways] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [random, setRandom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [pick, setPick] = useState('#ffcc66');   // HTML mode: colour to add
  const [blendA, setBlendA] = useState('#64ff33'); // HTML mode: blend from
  const [blendB, setBlendB] = useState('#ff336d'); // HTML mode: blend to

  // Escape closes the dialog. The save-name box handles its own Escape (to cancel just that) and
  // stops it bubbling here, so Escape there closes the name box first, not the whole dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const output = useMemo(
    () => makeGradient(text, codes, { bothways, reverse, random }, mode),
    [text, codes, bothways, reverse, random, mode],
  );
  const preview = useMemo(() => parseBacktick(output), [output]);
  const codeCount = parseCodes(codes, mode).length;

  // Quick-pick row: favourites for this mode first, then recently-used (deduped), up to a handful.
  // A chip's bar previews the gradient; clicking it loads those colours. The star toggle below marks
  // the selected preset a favourite. Recents fall back in so the row is useful before anything's starred.
  const chipColours = (codesStr: string, m: ColourMode) => {
    const cs = parseCodes(codesStr, m);
    return (m === 'html' ? cs : cs.map((c) => xtermHex(Number(c)))).filter(Boolean);
  };
  const chipBar = (codesStr: string, m: ColourMode) => {
    const cols = chipColours(codesStr, m);
    if (cols.length === 0) return 'var(--line)';
    if (cols.length === 1) return cols[0];
    return `linear-gradient(to right, ${cols.join(', ')})`;
  };
  const favs = activePresets.filter((p) => p.fav);
  const favCodes = new Set(favs.map((p) => p.codes));
  const recentChips = recents.filter((r) => r.mode === mode && !favCodes.has(r.codes)).slice(0, Math.max(0, 8 - favs.length));
  const quickChips = [
    ...favs.map((p) => ({ codes: p.codes, name: p.name, fav: true })),
    ...recentChips.map((r) => ({ codes: r.codes, name: r.name, fav: false })),
  ];
  const curFav = !!activePresets.find((p) => p.name === presetName)?.fav;

  // Any code change re-syncs the dropdown: if the codes match a preset, show it, else "Custom".
  const applyCodes = (c: string) => {
    setCodes(c);
    const hit = activePresets.find((p) => p.codes === c.trim());
    setPresetName(hit ? hit.name : '');
  };
  const applyPreset = (name: string) => {
    const p = activePresets.find((x) => x.name === name);
    if (!p) { setPresetName(''); return; }
    setPresetName(p.name);
    setCodes(p.codes);
  };
  // Step up/down the preset list; from "Custom" the down arrow starts at the top, up at the bottom.
  const stepPreset = (dir: 1 | -1) => {
    const n = activePresets.length;
    if (!n) return;
    const i = activePresets.findIndex((p) => p.name === presetName);
    const next = i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
    applyPreset(activePresets[next].name);
  };
  const switchMode = (m: ColourMode) => {
    if (m === mode) return;
    setMode(m);
    const first = (m === 'html' ? htmlPresets : presets)[0];
    setCodes(first?.codes ?? '');
    setPresetName(first?.name ?? '');
    setSaving(false);
  };
  const addCode = (nn: number) => applyCodes(`${codes.trim()} ${String(nn).padStart(3, '0')}`.trim());
  const addHex = (h: string) => applyCodes(`${codes.trim()} ${h}`.trim());
  const doBlend = () => applyCodes(blendHex(blendA, blendB, BLEND_STEPS).join(' '));
  // Smooth: fade through every stop currently in the box (not just two), so 3+ colours blend evenly.
  const doSmooth = () => applyCodes(blendMany(parseCodes(codes, 'html'), SMOOTH_PER).join(' '));
  const savePreset = () => {
    const name = saveName.trim();
    if (!name || !onSavePreset || !codeCount) return;
    onSavePreset({ name, codes: parseCodes(codes, mode).join(' ') }, mode);
    setPresetName(name);
    setSaving(false);
    setSaveName('');
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal composer">
        <button type="button" className="modal-x" title="Close" onClick={onClose}>×</button>
        <h2>Colour composer</h2>

        <div className="composer-mode" title="Which colour system to use">
          <button type="button" className={`btn small ${mode === 'xterm' ? 'primary' : 'ghost'}`} onClick={() => switchMode('xterm')}>Xterm</button>
          <button type="button" className={`btn small ${mode === 'html' ? 'primary' : 'ghost'}`} onClick={() => switchMode('html')}>HTML</button>
          <span className="hint">{mode === 'html' ? 'Truecolour #rrggbb codes' : 'Xterm 0-255 codes'}</span>
        </div>

        {quickChips.length > 0 && (
          <div className="composer-faves">
            <span className="hint">{favs.length ? 'Favourites' : 'Recent'}</span>
            <div className="fave-chips">
              {quickChips.map((c, i) => (
                <button type="button" key={`${c.fav ? 'f' : 'r'}-${i}`} className={`fave-chip ${c.fav ? 'is-fav' : ''}`}
                  title={`${c.fav ? '★ favourite' : 'recently used'}: ${c.name || 'gradient'} — click to load`}
                  onClick={() => applyCodes(c.codes)}>
                  <span className="fave-bar" style={{ background: chipBar(c.codes, mode) }} />
                  <span className="fave-name">{c.fav && <span className="fave-star">★</span>}{c.name || 'Recent'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label>Text to colour
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the pose or line you want to colour…" />
        </label>

        <div className="row">
          <label className="grow">Preset
            <div className="preset-row">
              <select className="grow" value={presetName} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Custom</option>
                {activePresets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <button type="button" className="btn small ghost step" title="Previous preset" onClick={() => stepPreset(-1)}>▲</button>
              <button type="button" className="btn small ghost step" title="Next preset" onClick={() => stepPreset(1)}>▼</button>
              {onToggleFavourite && (
                <button type="button" className={`btn small ghost step fave-btn ${curFav ? 'on' : ''}`}
                  disabled={!presetName}
                  title={!presetName ? 'Pick or save a preset to favourite it' : curFav ? 'Remove from favourites' : 'Add to favourites (shows in Quick pick)'}
                  onClick={() => presetName && onToggleFavourite(presetName, mode)}>{curFav ? '★' : '☆'}</button>
              )}
            </div>
          </label>
          <label className="check inline"><input type="checkbox" checked={bothways} onChange={(e) => setBothways(e.target.checked)} /> Fade both ways</label>
          <label className="check inline"><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Reverse</label>
          <label className="check inline"><input type="checkbox" checked={random} onChange={(e) => setRandom(e.target.checked)} /> Randomise</label>
        </div>

        <label>{mode === 'html' ? 'Colour codes (#rrggbb, space-separated)' : 'Colour codes (xterm 0-255, space-separated)'}
          <div className="row">
            <input className="mono grow" value={codes} onChange={(e) => applyCodes(e.target.value)} spellCheck={false} />
            <button type="button" className="btn small ghost" onClick={() => applyCodes('')}>Clear</button>
          </div>
        </label>

        {mode === 'html' ? (
          <div className="row composer-html-tools">
            <span className="html-tool">
              <span className="hint">Add</span>
              <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} title="Pick a colour to add" />
              <button type="button" className="btn small ghost" onClick={() => addHex(pick)}>+ colour</button>
            </span>
            <span className="html-tool">
              <span className="hint">Blend</span>
              <input type="color" value={blendA} onChange={(e) => setBlendA(e.target.value)} title="From colour" />
              <span className="hint">→</span>
              <input type="color" value={blendB} onChange={(e) => setBlendB(e.target.value)} title="To colour" />
              <button type="button" className="btn small ghost" title={`Fill a smooth ${BLEND_STEPS}-step gradient between the two`} onClick={doBlend}>Make gradient</button>
            </span>
            <span className="html-tool">
              <span className="hint">Smooth</span>
              <button type="button" className="btn small ghost" disabled={codeCount < 2}
                title="Fade smoothly through every colour in the box — add your stops with + colour (or load a preset), then smooth through all of them"
                onClick={doSmooth}>Smooth stops</button>
            </span>
          </div>
        ) : (
          <details className="composer-swatches">
            <summary className="hint">Pick colours by hand ({codeCount} in use) — click to add</summary>
            <div className="composer-grid">
              {SWATCHES.map((n) => (
                <button type="button" key={n} className="composer-sw" title={`xterm ${n}`} style={{ background: xtermHex(n) }} onClick={() => addCode(n)} />
              ))}
            </div>
          </details>
        )}

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

        {saving && (
          <div className="row preset-save">
            <input className="grow" autoFocus value={saveName} placeholder="Preset name" onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePreset(); } if (e.key === 'Escape') { e.stopPropagation(); setSaving(false); } }} />
            <button type="button" className="btn small primary" disabled={!saveName.trim()} onClick={savePreset}>
              {activePresets.some((p) => p.name === saveName.trim()) ? 'Replace preset' : 'Save preset'}
            </button>
            <button type="button" className="btn small ghost" onClick={() => setSaving(false)}>Cancel</button>
          </div>
        )}

        <div className="modal-actions">
          <span className="muted small">{copied ? 'Copied.' : `${text.length} chars · ${codeCount} colours`}</span>
          <span className="spacer" />
          {onSavePreset && !saving && (
            <button type="button" className="btn ghost" disabled={!codeCount} title={`Keep these colours as ${mode === 'html' ? 'an HTML' : 'an xterm'} preset (Settings › Presets lists and edits them)`} onClick={() => { setSaveName(presetName || ''); setSaving(true); }}>Save as preset…</button>
          )}
          <button type="button" className="btn ghost" onClick={copy} disabled={!output}>Copy</button>
          <button type="button" className="btn primary" disabled={!output} onClick={() => { pushRecent({ mode, codes: parseCodes(codes, mode).join(' '), name: presetName || undefined }); onInsert(output); onClose(); }}>Insert into command box</button>
        </div>
      </div>
    </div>
  );
}
