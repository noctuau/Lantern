/**
 * App-wide display settings (fonts, sizes, input height, colours). Persisted by
 * the main process in settings.json; applied here as CSS variables on :root so
 * every pane picks them up without re-rendering.
 */
export interface AppSettings {
  outputFont: string;
  outputSize: number;        // px
  outputLineHeight: number;  // multiplier
  outputWeight: number;      // font weight 100-900 (400 regular, 500 medium, ...)
  outputWidth: number;       // max line width in characters; 0 = fit the window. Also the width told to the server (NAWS).
  outputBg: string;          // output pane background: '' = theme default, else a CSS colour
  inputFont: string;
  inputSize: number;         // px
  inputWeight: number;       // font weight 100-900
  inputLines: number;        // minimum visible lines in the command box
  echoInput: boolean;        // show what you typed in the output pane
  cleanInput: boolean;       // swap curly quotes, long dashes, odd spaces… in typed commands for plain ASCII (cleanTyped)
  checkUpdates: boolean;     // ask GitHub for a newer release a few seconds after start (Settings › About)
  autoScroll: boolean;       // follow new output when already at the bottom
  palette: PaletteName;      // ANSI colour palette: a preset, or 'custom' to use customPalette
  customPalette: string[];   // 16 hex colours used when palette === 'custom'
  spellLanguages: string[];  // spell-check dictionaries, e.g. ['en-AU']; [] turns spell check off
  customColours: CustomColour[]; // named colours for the trigger colour picker (up to MAX_CUSTOM_COLOURS)
}

export type PaletteName = 'warm' | 'classic' | 'vga' | 'custom';

/** A named colour (text + optional background) for use when picking trigger colours. */
export interface CustomColour { id: string; name: string; fg: string; bg: string }
export const MAX_CUSTOM_COLOURS = 10;
export const DEFAULT_CUSTOM_COLOURS: CustomColour[] = [
  { id: 'c1', name: 'OOC blue', fg: '#6f9fd8', bg: '' },
  { id: 'c2', name: 'Soft green', fg: '#86b867', bg: '' },
  { id: 'c3', name: 'Rose', fg: '#dca9e6', bg: '' },
  { id: 'c4', name: 'Warning', fg: '#fbf6ec', bg: '#9a3b2b' },
];

/** 16 ANSI colours: 0-7 normal, 8-15 bright. */
export const PALETTES: Record<Exclude<PaletteName, 'custom'>, string[]> = {
  // Lantern's own warm-tuned set (the original look).
  warm: ['#3a3631', '#d9674f', '#86b867', '#e0b24a', '#6f9fd8', '#c58ad0', '#62b7b7', '#d6cfc2',
    '#6b655b', '#f0876d', '#a6d886', '#f5cf6c', '#93bdf0', '#dca9e6', '#86d6d6', '#fbf6ec'],
  // Classic VGA palette — what MUSHclient uses by default. Normal blue is a near-black navy.
  classic: ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'],
  // A slightly lifted VGA that keeps the classic hues but makes blue readable on black.
  vga: ['#000000', '#aa0000', '#00aa00', '#aa5500', '#0000aa', '#aa00aa', '#00aaaa', '#aaaaaa',
    '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff'],
};

export const DEFAULT_SETTINGS: AppSettings = {
  outputFont: 'Cascadia Mono',
  outputSize: 15,
  outputLineHeight: 1.5,
  outputWeight: 400,
  outputWidth: 0,
  outputBg: '',
  inputFont: 'Cascadia Mono',
  inputSize: 15,
  inputWeight: 400,
  inputLines: 1,
  echoInput: true,
  cleanInput: true,
  checkUpdates: true,
  autoScroll: true,
  palette: 'warm',
  customPalette: PALETTES.warm.slice(),
  spellLanguages: ['en-AU'],
  customColours: DEFAULT_CUSTOM_COLOURS.slice(),
};

/** Resolve the active 16 colours for a settings object. */
export function resolvePalette(s: AppSettings): string[] {
  if (s.palette === 'custom') return s.customPalette;
  return PALETTES[s.palette] ?? PALETTES.warm;
}

/** Fonts offered when the system font list is unavailable. */
export const FALLBACK_FONTS = [
  'Cascadia Mono', 'Consolas', 'Courier New', 'Lucida Console', 'Fixedsys', 'JetBrains Mono', 'Fira Code',
  'Segoe UI', 'Verdana', 'Georgia', 'Calibri', 'Tahoma', 'Times New Roman',
];

const MONO_FALLBACK = '"Cascadia Mono", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace';

function fontStack(name: string) {
  const n = name.trim();
  if (!n) return MONO_FALLBACK;
  return `"${n.replace(/"/g, '')}", ${MONO_FALLBACK}`;
}

export function normalizeSettings(s: Partial<AppSettings> | null | undefined): AppSettings {
  const clamp = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    outputFont: typeof s?.outputFont === 'string' ? s.outputFont : DEFAULT_SETTINGS.outputFont,
    outputSize: clamp(s?.outputSize, 9, 40, DEFAULT_SETTINGS.outputSize),
    outputLineHeight: clamp(s?.outputLineHeight, 1, 2.5, DEFAULT_SETTINGS.outputLineHeight),
    outputWeight: Math.round(clamp(s?.outputWeight, 100, 900, DEFAULT_SETTINGS.outputWeight)),
    outputWidth: s?.outputWidth === 0 ? 0 : Math.round(clamp(s?.outputWidth, 20, 500, DEFAULT_SETTINGS.outputWidth)),
    outputBg: typeof s?.outputBg === 'string' ? s.outputBg : DEFAULT_SETTINGS.outputBg,
    inputFont: typeof s?.inputFont === 'string' ? s.inputFont : DEFAULT_SETTINGS.inputFont,
    inputSize: clamp(s?.inputSize, 9, 40, DEFAULT_SETTINGS.inputSize),
    inputWeight: Math.round(clamp(s?.inputWeight, 100, 900, DEFAULT_SETTINGS.inputWeight)),
    inputLines: Math.round(clamp(s?.inputLines, 1, 20, DEFAULT_SETTINGS.inputLines)),
    echoInput: typeof s?.echoInput === 'boolean' ? s.echoInput : DEFAULT_SETTINGS.echoInput,
    cleanInput: typeof s?.cleanInput === 'boolean' ? s.cleanInput : DEFAULT_SETTINGS.cleanInput,
    checkUpdates: typeof s?.checkUpdates === 'boolean' ? s.checkUpdates : DEFAULT_SETTINGS.checkUpdates,
    autoScroll: typeof s?.autoScroll === 'boolean' ? s.autoScroll : DEFAULT_SETTINGS.autoScroll,
    palette: (['warm', 'classic', 'vga', 'custom'] as const).includes(s?.palette as PaletteName) ? (s!.palette as PaletteName) : 'warm',
    customPalette: Array.isArray(s?.customPalette) && s!.customPalette.length === 16
      ? s!.customPalette.map((c) => (typeof c === 'string' ? c : '#000000'))
      : DEFAULT_SETTINGS.customPalette.slice(),
    spellLanguages: Array.isArray(s?.spellLanguages) ? s!.spellLanguages.filter((x) => typeof x === 'string') : DEFAULT_SETTINGS.spellLanguages.slice(),
    customColours: Array.isArray(s?.customColours)
      ? s!.customColours.filter((c) => c && typeof c.fg === 'string').slice(0, MAX_CUSTOM_COLOURS).map((c, i) => ({ id: c.id || `c${i}`, name: c.name || `Colour ${i + 1}`, fg: c.fg, bg: typeof c.bg === 'string' ? c.bg : '' }))
      : DEFAULT_SETTINGS.customColours.slice(),
  };
}

export function applySettings(s: AppSettings) {
  const r = document.documentElement.style;
  r.setProperty('--font-mud', fontStack(s.outputFont));
  r.setProperty('--mud-size', `${s.outputSize}px`);
  r.setProperty('--mud-line', String(s.outputLineHeight));
  r.setProperty('--mud-weight', String(s.outputWeight));
  r.setProperty('--font-input', fontStack(s.inputFont));
  r.setProperty('--input-size', `${s.inputSize}px`);
  r.setProperty('--input-weight', String(s.inputWeight));
  r.setProperty('--mud-max-width', s.outputWidth ? `${s.outputWidth}ch` : 'none');
  // '' falls back to the theme background in the CSS (var(--output-bg, var(--bg))).
  if (s.outputBg) r.setProperty('--output-bg', s.outputBg);
  else r.removeProperty('--output-bg');
  // ANSI palette: the 16 colours triggers and the parser reference as var(--ansi-N).
  const palette = resolvePalette(s);
  palette.forEach((c, i) => r.setProperty(`--ansi-${i}`, c));
}

// Measuring a font means Chromium loading it, and a machine with hundreds of fonts (big CJK ones among
// them) can take many seconds over the whole list. So each verdict is kept in localStorage and measured
// once per machine, not once per run.
const MONO_KEY = 'lantern.monoFonts';
let monoCache: Map<string, boolean> | null = null;
let monoSave: ReturnType<typeof setTimeout> | null = null;
let canvas: CanvasRenderingContext2D | null = null;

function monoStore(): Map<string, boolean> {
  if (monoCache) return monoCache;
  monoCache = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(MONO_KEY) ?? '{}') as Record<string, boolean>;
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') monoCache.set(k, v);
  } catch { /* nothing remembered yet */ }
  return monoCache;
}

/** True when a font renders narrow and wide letters at the same width (so it is fixed-pitch). */
export function isMonospace(family: string): boolean {
  const cache = monoStore();
  const hit = cache.get(family);
  if (hit !== undefined) return hit;
  if (!canvas) canvas = document.createElement('canvas').getContext('2d');
  if (!canvas) return false;
  canvas.font = `32px "${family.replace(/"/g, '')}"`;
  const narrow = canvas.measureText('iiiiiiiiiill').width;
  const wide = canvas.measureText('WWWWWWWWWWMM').width;
  const mono = Math.abs(narrow - wide) < 0.5;
  cache.set(family, mono);
  if (monoSave) clearTimeout(monoSave);
  monoSave = setTimeout(() => {
    monoSave = null;
    try { localStorage.setItem(MONO_KEY, JSON.stringify(Object.fromEntries(cache))); } catch { /* storage full or blocked: measure again next run */ }
  }, 500);
  return mono;
}

let fontsPromise: Promise<string[]> | null = null;

/**
 * Installed font family names: from main (Windows via .NET, cached on disk there), else the Local
 * Font Access API when the browser grants it, else FALLBACK_FONTS. A real list is remembered for the
 * rest of the run; a fallback is not, so the next call tries again.
 */
export function listSystemFonts(): Promise<string[]> {
  if (fontsPromise) return fontsPromise;
  const p = fetchSystemFonts().then((f) => { if (f === FALLBACK_FONTS && fontsPromise === p) fontsPromise = null; return f; });
  fontsPromise = p;
  return p;
}

async function fetchSystemFonts(): Promise<string[]> {
  try {
    const fromOs = await window.lantern.fonts.list();
    if (fromOs.length) return fromOs;
  } catch { /* fall through to the browser API */ }
  try {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (!q) return FALLBACK_FONTS;
    const fonts = await q.call(window);
    const names = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b));
    return names.length ? names : FALLBACK_FONTS;
  } catch {
    return FALLBACK_FONTS;
  }
}
