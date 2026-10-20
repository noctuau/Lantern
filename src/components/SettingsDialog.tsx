/** App settings: fonts and sizes for the output pane and the command box. Changes preview live; Cancel reverts. */
import { useEffect, useState } from 'react';
import { applySettings, normalizeSettings, DEFAULT_SETTINGS, FALLBACK_FONTS, PALETTES, resolvePalette, type AppSettings, type PaletteName } from '../lib/settings';
import { FontPicker } from './FontPicker';

const ANSI_LABELS = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
  'Bright black', 'Bright red', 'Bright green', 'Bright yellow', 'Bright blue', 'Bright magenta', 'Bright cyan', 'Bright white'];
const PALETTE_LABELS: Record<PaletteName, string> = { warm: 'Lantern (warm)', classic: 'Classic (MUSHclient)', vga: 'Classic, readable blue', custom: 'Custom' };

interface Props {
  settings: AppSettings;
  fonts: string[];
  onSave(s: AppSettings): void;
  onClose(): void;
}

const LANG_LABELS: Record<string, string> = {
  'en-AU': 'English (Australia)', 'en-GB': 'English (UK)', 'en-US': 'English (US)', 'en-CA': 'English (Canada)',
  'fr': 'French', 'fr-FR': 'French', 'de': 'German', 'es': 'Spanish', 'it': 'Italian', 'pt-BR': 'Portuguese (Brazil)',
  'pt-PT': 'Portuguese', 'nl': 'Dutch', 'sv': 'Swedish', 'nb': 'Norwegian', 'da': 'Danish', 'pl': 'Polish', 'ru': 'Russian',
};
const langLabel = (c: string) => LANG_LABELS[c] ?? c;

export function SettingsDialog({ settings, fonts, onSave, onClose }: Props) {
  const [s, setS] = useState<AppSettings>(settings);
  const [langs, setLangs] = useState<string[]>([]);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setS((x) => ({ ...x, [k]: v }));

  useEffect(() => { window.lantern.spell.languages().then((r) => setLangs(r.available)); }, []);
  const toggleLang = (code: string) => setS((x) => ({
    ...x,
    spellLanguages: x.spellLanguages.includes(code) ? x.spellLanguages.filter((l) => l !== code) : [...x.spellLanguages, code],
  }));

  // Shift every colour lighter/darker, except the greyscale ones (black, white, grey, bright white),
  // the way MUSHclient's Lighter/Darker buttons do. Mixes each channel toward white or black.
  const GREYSCALE = new Set([0, 7, 8, 15]);
  const nudge = (hex: string, toward: 255 | 0, t: number) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    const ch = [1, 2, 3].map((i) => {
      const v = parseInt(m[i], 16);
      return Math.round(v + (toward - v) * t).toString(16).padStart(2, '0');
    });
    return '#' + ch.join('');
  };
  const shift = (toward: 255 | 0) => {
    const base = resolvePalette(s).map((c, i) => (GREYSCALE.has(i) ? c : nudge(c, toward, 0.12)));
    setS((x) => ({ ...x, palette: 'custom', customPalette: base }));
  };

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

        <h3>Colours (ANSI palette)</h3>
        <p className="hint">How the game's 16 colours look. Classic matches MUSHclient; pick it if colours look off or a line shows a bright blue that MUSHclient keeps dark.</p>
        <div className="row">
          <label className="grow">Palette
            <select value={s.palette} onChange={(e) => set('palette', e.target.value as PaletteName)}>
              {(['warm', 'classic', 'vga', 'custom'] as PaletteName[]).map((p) => <option key={p} value={p}>{PALETTE_LABELS[p]}</option>)}
            </select>
          </label>
        </div>
        <div className="palette-grid">
          {resolvePalette(s).map((c, i) => (
            <label key={i} className="palette-swatch" title={ANSI_LABELS[i]}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : '#000000'}
                onChange={(e) => {
                  const base = resolvePalette(s).slice();
                  base[i] = e.target.value;
                  setS((x) => ({ ...x, palette: 'custom', customPalette: base }));
                }} />
              <span>{i}</span>
            </label>
          ))}
        </div>
        <div className="palette-actions">
          <button type="button" className="btn small" onClick={() => shift(255)}>Lighter</button>
          <button type="button" className="btn small" onClick={() => shift(0)}>Darker</button>
          <span className="hint">Shifts all colours except black and white.</span>
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

        <h3>Spell check</h3>
        <p className="hint">Underlines misspellings in the command box. Right-click a word for suggestions or to add it to your personal dictionary. Pick one or more dictionaries; none means spell check is off.</p>
        <div className="lang-grid">
          {(langs.length ? langs : ['en-AU', 'en-GB', 'en-US']).filter((c) => c.startsWith('en') || s.spellLanguages.includes(c)).map((c) => (
            <label key={c} className="check inline"><input type="checkbox" checked={s.spellLanguages.includes(c)} onChange={() => toggleLang(c)} /> {langLabel(c)}</label>
          ))}
        </div>
        {langs.length > 0 && (
          <details className="lang-more">
            <summary className="hint">Other languages</summary>
            <div className="lang-grid">
              {langs.filter((c) => !c.startsWith('en')).map((c) => (
                <label key={c} className="check inline"><input type="checkbox" checked={s.spellLanguages.includes(c)} onChange={() => toggleLang(c)} /> {langLabel(c)}</label>
              ))}
            </div>
          </details>
        )}

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
