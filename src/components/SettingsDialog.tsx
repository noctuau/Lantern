/** App settings: fonts and sizes for the output pane and the command box. Changes preview live; Cancel reverts. */
import { useEffect, useState } from 'react';
import { applySettings, normalizeSettings, DEFAULT_SETTINGS, FALLBACK_FONTS, type AppSettings } from '../lib/settings';
import { FontPicker } from './FontPicker';

interface Props {
  settings: AppSettings;
  fonts: string[];
  onSave(s: AppSettings): void;
  onClose(): void;
}

export function SettingsDialog({ settings, fonts, onSave, onClose }: Props) {
  const [s, setS] = useState<AppSettings>(settings);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setS((x) => ({ ...x, [k]: v }));

  // Live preview; put the saved settings back if the dialog is cancelled.
  useEffect(() => { applySettings(normalizeSettings(s)); }, [s]);
  useEffect(() => () => applySettings(settings), [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const num = (k: 'outputSize' | 'inputSize' | 'inputLines' | 'outputLineHeight', step = 1, min = 1, max = 40) => (
    <input type="number" step={step} min={min} max={max} value={s[k]}
      onChange={(e) => set(k, e.target.value === '' ? s[k] : Number(e.target.value))} style={{ width: 90 }} />
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={(e) => { e.preventDefault(); onSave(normalizeSettings(s)); }}>
        <h2>Settings</h2>
        {fonts === FALLBACK_FONTS && (
          <p className="hint">Windows did not share its font list, so this shows a few common fonts. You can still type any installed font's name.</p>
        )}

        <h3>Output pane</h3>
        <div className="row">
          <label className="grow">Font
            <FontPicker value={s.outputFont} fonts={fonts} onChange={(v) => set('outputFont', v)} />
          </label>
          <label>Size (px){num('outputSize', 1, 9, 40)}</label>
          <label>Line spacing{num('outputLineHeight', 0.05, 1, 2.5)}</label>
          <label title="Maximum characters per line. 0 fills the window. Also the width Lantern tells the game, so server-wrapped MUSHes follow it.">Width (chars)
            <input type="number" step={1} min={0} max={500} value={s.outputWidth}
              onChange={(e) => set('outputWidth', e.target.value === '' ? s.outputWidth : Math.max(0, Math.min(500, Number(e.target.value))))} style={{ width: 90 }} />
          </label>
        </div>
        <p className="hint">Width caps how wide lines get (0 = fill the window) and is the size Lantern reports to the game, so games that wrap text themselves use it too.</p>
        <div className="row bg-row">
          <label>Background
            <div className="bg-choices">
              <button type="button" className={`bg-chip ${s.outputBg === '' ? 'active' : ''}`} title="The warm theme background" onClick={() => set('outputBg', '')}>
                <span className="bg-swatch" style={{ background: '#14120f' }} /> Theme
              </button>
              <button type="button" className={`bg-chip ${s.outputBg.toLowerCase() === '#000000' ? 'active' : ''}`} title="Fully black" onClick={() => set('outputBg', '#000000')}>
                <span className="bg-swatch" style={{ background: '#000000' }} /> Black
              </button>
              <input type="color" title="Pick any background colour" value={/^#[0-9a-f]{6}$/i.test(s.outputBg) ? s.outputBg : '#000000'} onChange={(e) => set('outputBg', e.target.value)} />
              <input className="mono" style={{ width: 110 }} value={s.outputBg} placeholder="theme" spellCheck={false}
                onChange={(e) => set('outputBg', e.target.value.trim())} />
            </div>
          </label>
        </div>
        <div className="settings-preview output-preview">
          Lantern flickers; the long night settles over the harbour. <span style={{ color: 'var(--ansi-11)' }}>Juliet</span> says, "Mind the step."
        </div>

        <h3>Command box</h3>
        <div className="row">
          <label className="grow">Font
            <FontPicker value={s.inputFont} fonts={fonts} onChange={(v) => set('inputFont', v)} />
          </label>
          <label>Size (px){num('inputSize', 1, 9, 40)}</label>
          <label>Lines shown{num('inputLines', 1, 1, 20)}</label>
        </div>
        <p className="hint">The box always grows as you type. "Lines shown" is its resting height; you can also drag its top edge.</p>
        <label className="check inline"><input type="checkbox" checked={s.echoInput} onChange={(e) => set('echoInput', e.target.checked)} /> Echo my commands in the output (in the pane they were typed from)</label>
        <div className="settings-preview input-preview">A pose, typed here, in the command box font.</div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => setS(DEFAULT_SETTINGS)}>Reset to defaults</button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}
