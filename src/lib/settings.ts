/**
 * App-wide display settings (fonts, sizes, input height, colours). Persisted by
 * the main process in settings.json; applied here as CSS variables on :root so
 * every pane picks them up without re-rendering.
 */
export interface AppSettings {
  outputFont: string;
  outputSize: number;        // px
  outputLineHeight: number;  // multiplier
  outputWidth: number;       // max line width in characters; 0 = fit the window. Also the width told to the server (NAWS).
  outputBg: string;          // output pane background: '' = theme default, else a CSS colour
  inputFont: string;
  inputSize: number;         // px
  inputLines: number;        // minimum visible lines in the command box
  echoInput: boolean;        // show what you typed in the output pane
}

export const DEFAULT_SETTINGS: AppSettings = {
  outputFont: 'Cascadia Mono',
  outputSize: 15,
  outputLineHeight: 1.5,
  outputWidth: 0,
  outputBg: '',
  inputFont: 'Cascadia Mono',
  inputSize: 15,
  inputLines: 1,
  echoInput: true,
};

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
    outputWidth: s?.outputWidth === 0 ? 0 : Math.round(clamp(s?.outputWidth, 20, 500, DEFAULT_SETTINGS.outputWidth)),
    outputBg: typeof s?.outputBg === 'string' ? s.outputBg : DEFAULT_SETTINGS.outputBg,
    inputFont: typeof s?.inputFont === 'string' ? s.inputFont : DEFAULT_SETTINGS.inputFont,
    inputSize: clamp(s?.inputSize, 9, 40, DEFAULT_SETTINGS.inputSize),
    inputLines: Math.round(clamp(s?.inputLines, 1, 20, DEFAULT_SETTINGS.inputLines)),
    echoInput: typeof s?.echoInput === 'boolean' ? s.echoInput : DEFAULT_SETTINGS.echoInput,
  };
}

export function applySettings(s: AppSettings) {
  const r = document.documentElement.style;
  r.setProperty('--font-mud', fontStack(s.outputFont));
  r.setProperty('--mud-size', `${s.outputSize}px`);
  r.setProperty('--mud-line', String(s.outputLineHeight));
  r.setProperty('--font-input', fontStack(s.inputFont));
  r.setProperty('--input-size', `${s.inputSize}px`);
  r.setProperty('--mud-max-width', s.outputWidth ? `${s.outputWidth}ch` : 'none');
  // '' falls back to the theme background in the CSS (var(--output-bg, var(--bg))).
  if (s.outputBg) r.setProperty('--output-bg', s.outputBg);
  else r.removeProperty('--output-bg');
}

const monoCache = new Map<string, boolean>();
let canvas: CanvasRenderingContext2D | null = null;

/** True when a font renders narrow and wide letters at the same width (so it is fixed-pitch). */
export function isMonospace(family: string): boolean {
  const hit = monoCache.get(family);
  if (hit !== undefined) return hit;
  if (!canvas) canvas = document.createElement('canvas').getContext('2d');
  if (!canvas) return false;
  canvas.font = `32px "${family.replace(/"/g, '')}"`;
  const narrow = canvas.measureText('iiiiiiiiiill').width;
  const wide = canvas.measureText('WWWWWWWWWWMM').width;
  const mono = Math.abs(narrow - wide) < 0.5;
  monoCache.set(family, mono);
  return mono;
}

/** Installed font family names, via the Local Font Access API when the browser grants it. */
export async function listSystemFonts(): Promise<string[]> {
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
