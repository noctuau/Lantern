/** App settings: fonts and sizes for the output pane and the command box. Changes preview live; Cancel reverts. */
import { useEffect, useState } from 'react';
import { applySettings, normalizeSettings, DEFAULT_SETTINGS, FALLBACK_FONTS, PALETTES, resolvePalette, MAX_CUSTOM_COLOURS, type AppSettings, type PaletteName, type CustomColour } from '../lib/settings';
import { FontPicker } from './FontPicker';
import { AboutTab } from './AboutTab';
import type { UpdateInfo } from '../../shared/updates';

const ANSI_LABELS = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
  'Bright black', 'Bright red', 'Bright green', 'Bright yellow', 'Bright blue', 'Bright magenta', 'Bright cyan', 'Bright white'];
const PALETTE_LABELS: Record<PaletteName, string> = { warm: 'Lantern (warm)', classic: 'Classic (MUSHclient)', vga: 'Classic, readable blue', custom: 'Custom' };

interface Props {
  settings: AppSettings;
  fonts: string[];
  onSave(s: AppSettings): void;
  onClose(): void;
  /** Which tab to open on (About when an update is waiting). */
  initialTab?: SettingsTab;
  /** The last update check (the startup one, or an earlier look at About). */
  update?: UpdateInfo | null;
  onUpdate?(u: UpdateInfo | null): void;
}

const LANG_LABELS: Record<string, string> = {
  'en-AU': 'English (Australia)', 'en-GB': 'English (UK)', 'en-US': 'English (US)', 'en-CA': 'English (Canada)',
  'fr': 'French', 'fr-FR': 'French', 'de': 'German', 'es': 'Spanish', 'it': 'Italian', 'pt-BR': 'Portuguese (Brazil)',
  'pt-PT': 'Portuguese', 'nl': 'Dutch', 'sv': 'Swedish', 'nb': 'Norwegian', 'da': 'Danish', 'pl': 'Polish', 'ru': 'Russian',
};
const langLabel = (c: string) => LANG_LABELS[c] ?? c;

export type SettingsTab = 'text' | 'colours' | 'spelling' | 'about';
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'text', label: 'Text & layout' },
  { id: 'colours', label: 'Colours' },
  { id: 'spelling', label: 'Spelling' },
  { id: 'about', label: 'About' },
];

export function SettingsDialog({ settings, fonts, onSave, onClose, initialTab = 'text', update = null, onUpdate }: Props) {
  const [s, setS] = useState<AppSettings>(settings);
  const [langs, setLangs] = useState<string[]>([]);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
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

  // Custom colours (named text/background pairs for the trigger picker).
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const setCustom = (i: number, patch: Partial<CustomColour>) =>
    setS((x) => ({ ...x, customColours: x.customColours.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const addCustom = () =>
    setS((x) => ({ ...x, customColours: [...x.customColours, { id: uid(), name: `Colour ${x.customColours.length + 1}`, fg: '#e8a94b', bg: '' }] }));
  const removeCustom = (i: number) => setS((x) => ({ ...x, customColours: x.customColours.filter((_, j) => j !== i) }));

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
  const WEIGHTS: [number, string][] = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold']];
  const weightSelect = (k: 'outputWeight' | 'inputWeight') => (
    <select value={s[k]} onChange={(e) => set(k, Number(e.target.value))} style={{ width: 110 }}>
      {WEIGHTS.map(([w, label]) => <option key={w} value={w}>{label}</option>)}
    </select>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal settings" onSubmit={(e) => { e.preventDefault(); onSave(normalizeSettings(s)); }}>
        <button type="button" className="modal-x" title="Close" onClick={onClose}>×</button>
        <div className="settings-head"><h2>Settings</h2></div>
        <div className="settings-body">
          <nav className="settings-nav">
            {SETTINGS_TABS.map((t) => (
              <button type="button" key={t.id} className={`settings-navitem ${tab === t.id ? 'active' : ''} ${t.id === 'about' && update?.newer ? 'has-update' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </nav>
          <div className="settings-pane">
            {fonts === FALLBACK_FONTS && tab === 'text' && (
              <p className="hint">Windows did not share its font list, so this shows a few common fonts. You can still type any installed font's name.</p>
            )}

            {tab === 'text' && (<>
              <h3>Output pane</h3>
              <div className="row">
                <label className="grow">Font
                  <FontPicker value={s.outputFont} fonts={fonts} onChange={(v) => set('outputFont', v)} />
                </label>
                <label title="Font weight, if the font family has more than one (e.g. Medium).">Weight{weightSelect('outputWeight')}</label>
                <label>Size (px){num('outputSize', 1, 9, 40)}</label>
                <label>Line spacing{num('outputLineHeight', 0.05, 1, 2.5)}</label>
                <label title="Maximum characters per line. 0 fills the window. Also the width Lantern tells the game, so server-wrapped MUSHes follow it.">Width (chars)
                  <input type="number" step={1} min={0} max={500} value={s.outputWidth}
                    onChange={(e) => set('outputWidth', e.target.value === '' ? s.outputWidth : Math.max(0, Math.min(500, Number(e.target.value))))} style={{ width: 90 }} />
                </label>
              </div>
              <p className="hint">Width caps how wide lines get (0 = fill the window) and is the size Lantern reports to the game, so games that wrap text themselves use it too.</p>
              <label className="check inline"><input type="checkbox" checked={s.autoScroll} onChange={(e) => set('autoScroll', e.target.checked)} /> Scroll to new output while I'm at the bottom (stays put if I've scrolled up)</label>
              <div className="settings-preview output-preview">
                Lantern flickers; the long night settles over the harbour. <span style={{ color: 'var(--ansi-11)' }}>Juliet</span> says, "Mind the step."
              </div>

              <h3>Command box</h3>
              <div className="row">
                <label className="grow">Font
                  <FontPicker value={s.inputFont} fonts={fonts} onChange={(v) => set('inputFont', v)} />
                </label>
                <label title="Font weight.">Weight{weightSelect('inputWeight')}</label>
                <label>Size (px){num('inputSize', 1, 9, 40)}</label>
                <label>Lines shown{num('inputLines', 1, 1, 20)}</label>
              </div>
              <p className="hint">The box always grows as you type. "Lines shown" is its resting height; you can also drag its top edge.</p>
              <label className="check inline"><input type="checkbox" checked={s.echoInput} onChange={(e) => set('echoInput', e.target.checked)} /> Echo my commands in the output (in the pane they were typed from)</label>
              <label className="check inline" title={'Curly quotes become straight ones, – and — become - and --, … becomes ..., non-breaking and other odd spaces become a space, and invisible characters are dropped. Accented letters, symbols and emoji are left alone. Passwords are never touched.'}>
                <input type="checkbox" checked={s.cleanInput} onChange={(e) => set('cleanInput', e.target.checked)} /> Tidy what I type for the game (“curly” quotes → "straight", long dashes, ellipsis, odd spaces)
              </label>
              <div className="settings-preview input-preview">A pose, typed here, in the command box font.</div>
            </>)}

            {tab === 'colours' && (<>
              <h3>Background</h3>
              <div className="row bg-row">
                <label>Output background
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

              <h3>ANSI palette</h3>
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
              <div className="settings-preview output-preview">
                Lantern flickers; the long night settles over the harbour. <span style={{ color: 'var(--ansi-11)' }}>Juliet</span> says, "Mind the step."
              </div>

              <h3>Custom colours</h3>
              <p className="hint">Named colours (text and optional background) separate from the ANSI palette. They appear when you pick a colour for a trigger. Up to {MAX_CUSTOM_COLOURS}.</p>
              <div className="customcol-list">
                {s.customColours.map((c, i) => (
                  <div key={c.id} className="customcol-edit">
                    <span className="customcol-preview" style={{ color: c.fg, background: c.bg || 'transparent' }}>Abc</span>
                    <input className="customcol-name" value={c.name} placeholder={`Colour ${i + 1}`}
                      onChange={(e) => setCustom(i, { name: e.target.value })} />
                    <label className="customcol-pick">Text<input type="color" value={/^#[0-9a-f]{6}$/i.test(c.fg) ? c.fg : '#e6dfd2'} onChange={(e) => setCustom(i, { fg: e.target.value })} /></label>
                    <label className="customcol-pick">Bg
                      <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.bg) ? c.bg : '#000000'} onChange={(e) => setCustom(i, { bg: e.target.value })} />
                    </label>
                    <button type="button" className="icon-btn" title={c.bg ? 'Remove background' : 'No background'} onClick={() => setCustom(i, { bg: '' })}>{c.bg ? '⌫' : '—'}</button>
                    <button type="button" className="icon-btn danger" title="Delete this colour" onClick={() => removeCustom(i)}>×</button>
                  </div>
                ))}
              </div>
              {s.customColours.length < MAX_CUSTOM_COLOURS && (
                <button type="button" className="btn small" onClick={addCustom}>+ Add colour</button>
              )}
            </>)}

            {tab === 'spelling' && (<>
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
            </>)}

            {tab === 'about' && (
              <AboutTab checkOnStart={s.checkUpdates} onCheckOnStart={(v) => set('checkUpdates', v)} update={update} onUpdate={(u) => onUpdate?.(u)} />
            )}
          </div>
        </div>

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
