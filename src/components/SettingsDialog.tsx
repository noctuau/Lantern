/** App settings: fonts and sizes for the output pane and the command box. Changes preview live; Cancel reverts. */
import { useEffect, useState } from 'react';
import { applySettings, normalizeSettings, DEFAULT_SETTINGS, type AppSettings } from '../lib/settings';

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
        <datalist id="font-list">{fonts.map((f) => <option key={f} value={f} />)}</datalist>

        <h3>Output pane</h3>
        <div className="row">
          <label className="grow">Font
            <input list="font-list" value={s.outputFont} onChange={(e) => set('outputFont', e.target.value)} placeholder="Cascadia Mono" />
          </label>
          <label>Size (px){num('outputSize', 1, 9, 40)}</label>
          <label>Line spacing{num('outputLineHeight', 0.05, 1, 2.5)}</label>
        </div>
        <div className="settings-preview output-preview">
          Lantern flickers; the long night settles over the harbour. <span style={{ color: 'var(--ansi-11)' }}>Juliet</span> says, "Mind the step."
        </div>

        <h3>Command box</h3>
        <div className="row">
          <label className="grow">Font
            <input list="font-list" value={s.inputFont} onChange={(e) => set('inputFont', e.target.value)} placeholder="Cascadia Mono" />
          </label>
          <label>Size (px){num('inputSize', 1, 9, 40)}</label>
          <label>Lines shown{num('inputLines', 1, 1, 20)}</label>
        </div>
        <p className="hint">The box always grows as you type. "Lines shown" is its resting height; you can also drag its top edge.</p>
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
