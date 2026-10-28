/**
 * MUD colour gradient composer. Spreads a series of xterm-256 colour codes across a string and
 * emits the game's backtick codes (`NNN … `w), ready to paste or send. Ported from Noctua's own
 * "MUD Gradient Maker" (codepen.io/petal-/full/ExzbWWw), for codebases that use backtick xterm
 * colour (Haven and the other MUDs sharing that codebase).
 */
import { xterm256 } from './ansi';

export interface GradientPreset { name: string; codes: string; fav?: boolean }
export interface GradientOptions { bothways: boolean; reverse: boolean; random: boolean }
/** Which colour system the codes use: xterm-256 indices (`NNN) or HTML truecolour (`#rrggbb). */
export type ColourMode = 'xterm' | 'html';

/** Classic VGA for the 16 base indices; xterm-256 cube for 16-255 (same as the game's CLUT). */
const VGA16 = ['000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
  '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff'];

/** Hex (#rrggbb) for an xterm code 0-255; '' for an unknown code. */
export function xtermHex(n: number): string {
  if (n >= 0 && n < 16) return '#' + VGA16[n];
  const h = xterm256(n);
  return h || '';
}

function shuffle<T>(a: T[]): T[] { return a.sort(() => Math.random() - 0.5); }

/** [r,g,b] 0-255 for a #rgb or #rrggbb string, or null. */
export function hexToRgb(h: string): [number, number, number] | null {
  let s = h.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');

/** An evenly-spaced colour ramp of `steps` #rrggbb values from `a` to `b` (RGB interpolation). */
export function blendHex(a: string, b: string, steps: number): string[] {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  if (!pa || !pb) return [];
  if (steps < 2) return [toHex(...pa)];
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    out.push(toHex(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t));
  }
  return out;
}

/**
 * A smooth ramp that passes through EVERY stop in `stops`, blending `perSegment` colours between
 * each adjacent pair (the shared colour at a join isn't repeated). So three stops fade through the
 * middle one rather than snapping. Unparseable stops are skipped; fewer than two leaves it as-is.
 */
export function blendMany(stops: string[], perSegment: number): string[] {
  const valid = stops.map((s) => hexToRgb(s)).filter((p): p is [number, number, number] => !!p).map((p) => toHex(...p));
  if (valid.length < 2) return valid;
  const out: string[] = [];
  for (let i = 0; i < valid.length - 1; i++) {
    const seg = blendHex(valid[i], valid[i + 1], perSegment);
    out.push(...(i > 0 ? seg.slice(1) : seg));
  }
  return out;
}

/** Clean a free-text list of codes into code strings: xterm = 1-3 digit numbers, html = #rrggbb. */
export function parseCodes(codesStr: string, mode: ColourMode = 'xterm'): string[] {
  if (mode === 'html') {
    return codesStr.split(/[\s,;]+/).map((t) => hexToRgb(t)).filter((p): p is [number, number, number] => !!p).map((p) => toHex(...p));
  }
  return codesStr.replace(/[^\d\s]/g, '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
}

/**
 * Apply a gradient. Inserts `NNN tokens evenly across the text and appends `w (reset), exactly as
 * the original tool: token i goes at position i*(freq+1), where freq = textLength / codeCount.
 */
export function makeGradient(text: string, codesStr: string, opts: GradientOptions, mode: ColourMode = 'xterm'): string {
  if (!text) return '';
  let codes = parseCodes(codesStr, mode);
  if (!codes.length) return text;
  if (opts.random) codes = shuffle(codes.slice());
  if (opts.reverse) codes = codes.slice().reverse();
  if (opts.bothways) codes = codes.concat(codes.slice().reverse());

  const freq = text.length / codes.length;
  const a = text.split('');
  let idx = 0;
  for (let i = 0; i < codes.length && idx <= a.length; i++) {
    a.splice(Math.trunc(idx), 0, '`' + codes[i]);
    idx += freq + 1;
  }
  return a.join('') + '`w';
}

export interface ColourSpan { text: string; hex: string | null }

/**
 * Parse a backtick-coded string into coloured spans for preview. Handles `NNN (xterm colour) and
 * `w / other `<letter> codes (treated as reset to the default colour, which is all the composer
 * emits). A lone trailing backtick is ignored.
 */
export function parseBacktick(str: string): ColourSpan[] {
  const out: ColourSpan[] = [];
  let hex: string | null = null;
  let buf = '';
  const flush = () => { if (buf) { out.push({ text: buf, hex }); buf = ''; } };
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '`') {
      const hexm = str.slice(i + 1).match(/^#[0-9a-fA-F]{6}/);
      if (hexm) { flush(); hex = hexm[0].toLowerCase(); i += hexm[0].length; continue; } // `#rrggbb truecolour
      const digits = str.slice(i + 1).match(/^\d{1,3}/);
      if (digits) { flush(); hex = xtermHex(Number(digits[0])) || null; i += digits[0].length; continue; }
      const letter = str[i + 1];
      if (letter && /[a-zA-Z]/.test(letter)) { flush(); hex = null; i += 1; continue; } // `w etc. = reset
      // a stray backtick: keep it as text
    }
    buf += str[i];
  }
  flush();
  return out;
}

/** Noctua's gradient presets, carried over from the original tool. */
/**
 * Clean a preset list from settings.json: each entry needs a name (made unique with " (2)" when
 * it repeats) and a codes string (tidied the way the composer reads it). A missing list means
 * the built-ins; an empty list stays empty, since deleting them all is a choice.
 */
export function normalizePresets(raw: unknown, mode: ColourMode = 'xterm'): GradientPreset[] {
  if (!Array.isArray(raw)) return (mode === 'html' ? HTML_PRESETS : GRADIENT_PRESETS).map((p) => ({ ...p }));
  const out: GradientPreset[] = [];
  const names = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, codes, fav } = item as { name?: unknown; codes?: unknown; fav?: unknown };
    const base = typeof name === 'string' && name.trim() ? name.trim() : 'Preset';
    let n = base;
    for (let k = 2; names.has(n); k++) n = `${base} (${k})`;
    names.add(n);
    const tidied = typeof codes === 'string' ? parseCodes(codes, mode).join(' ') : '';
    out.push(fav === true ? { name: n, codes: tidied, fav: true } : { name: n, codes: tidied });
  }
  return out;
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { name: "Ophelia White", codes: "231 255 254 253 252 251" },
  { name: "Metallic Silver", codes: "247 248 249 250 251 252 253 254 255 231 231" },
  { name: "Tarnished Silver", codes: "243 245 243 244 246 244 245 247 245 248 250 248 249 247 249 250 248 250 251 249 251 252 250 252 253 251 253 254 252 254" },
  { name: "The Cowl", codes: "238 239 240 241 242 241 240 239 238" },
  { name: "Shatter Punch", codes: "240 241 243 244 242 244 246 243 245 245 247 248 249 251 249 251 252 254 252 253 251 253 252 253 255 255" },
  { name: "Grey Tones", codes: "239 240 241 242 243 245 246 247 248 249 250 251 252 253" },
  { name: "Aged Armour", codes: "058 101 102 244 245 144 248 058 101 245 144 058 244 239 240 247 248 239 247 248 240 239 058 101 244 245 144 248 058 101" },
  { name: "Dirty Armour", codes: "243 242 241 058 241 241 241 058 241 241 241 058 241 241 100 241 241 058 241 058 241 241 241 243 242 241 058 241 241 241 058 241 241 241 058 241 241 100 241 241 058 241 058 241 241 241 243 242 241 058 241 241 241 058 241 241 241 241 242 243" },
  { name: "Grey Soapstone", codes: "252 253 251 243 252 253 252 243 253 252 252 251 252 243 251 251 252 251 250 243 250 251 252 251 243 250 243 250 249 250 243 249 249 248 249 248 249 250 248 248 249 248 248 243 247 248 247" },
  { name: "Jericho Red", codes: "088 124 160 196 196" },
  { name: "Black Red", codes: "241 240 239 088 124 160 196" },
  { name: "Ox-Blood", codes: "089 126 089 126 162 126 089 126 089" },
  { name: "Rose Red", codes: "160 161 162 162" },
  { name: "Dirty Blood Moon", codes: "240 236 239 236 238 240 238 239 241 239 240 241 240 242 059 241 059 095 059 095 131 095 131 167 131 167 203 167 203 202 203 202 196 202 196 160 196 160 124 160 124" },
  { name: "Blood Moon", codes: "059 095 131 167 167" },
  { name: "Speedster", codes: "252 253 254 255 231 225 219 213 207 201" },
  { name: "Soft Pink", codes: "224 225 231 231" },
  { name: "Rose Coral", codes: "189 183 189 183 177 176 175 176 175 211 210 211 210 204 198 204 198 162 126 162 126 162 126" },
  { name: "Bluejay", codes: "024 030 031 032 031 030 024 030 031 032 031 030 024 030 031 032 033 045" },
  { name: "Peacock Blues", codes: "024 023 022 028 034 028 022 022" },
  { name: "Sapphire Blues", codes: "025 026 027 025 032 039 032 039 074 074 039 074 074 074 039 117 074 117 080 117" },
  { name: "Jericho Blue", codes: "019 020 019 021 027 026 027 026 025 026 025 031 037 074 080 117 123 117" },
  { name: "Aquamarines", codes: "079 159 080 079 072 117 079 072 080 072 079" },
  { name: "Soft Blue", codes: "117 123 159 195 231 231" },
  { name: "Soft Yellow", codes: "228 229 230 231 231" },
  { name: "Captain Justice Yellow", codes: "214 220 220 226 226 220 220 220 221 221 222 222 221 221 220 221 220 220 220 220 220" },
  { name: "Yellow Gold", codes: "220 221 227 228 229 229" },
  { name: "Aged Gold", codes: "100 136 172 214 220 214 220 214 172 136 100 136 172 214 220" },
  { name: "Orange Gold", codes: "214 220 226 226" },
  { name: "Orange Coral", codes: "209 210 211 218 225" },
  { name: "Mint Toothpaste", codes: "075 081 087 123 159" },
  { name: "Soft Green", codes: "156 156 155 192 193 194 231 231 231 231 231 231 194 193 192 155 156 156" },
  { name: "Mint Green", codes: "065 108 151 194 194 231 231" },
  { name: "Sage Green", codes: "151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152 151 194 253 152" },
  { name: "Green Fields", codes: "120 119 154 155 156 157" },
  { name: "Ocean Greens", codes: "043 042 048 084 085 086" },
  { name: "Coral Greens", codes: "066 109 151 152 153 159 195 194 230" },
  { name: "Forest Greens", codes: "065 064 065 064 065" },
  { name: "Yellow Green", codes: "072 108 150 192 192" },
  { name: "Light Green", codes: "120 119 156 156 157 157 157" },
  { name: "Emeralds", codes: "028 029 028 029 030 029 030 029 030 029 028 029 028 034 029 034 070 034 070 029 034 070 034 034 070 034" },
  { name: "Soft Orange", codes: "215 222 229 230 231 231" },
  { name: "Peach Cobbler", codes: "221 227 227 221 227 227 221 227 221 227 221 227 221 221 215 221 215 221 216 215 215 216 216 216 215 210 216 210" },
  { name: "Soft Peonies", codes: "230 224 223 222 223 224 230 224 223 222 223 224 230 224 223 222 223 224 230 224 223 222 223 224" },
  { name: "Pumpkin Orange", codes: "208 173 215 215" },
  { name: "Mixed Carrots", codes: "220 202 214 220 220 214 220 214 214 208 178 208 208 220 214 202 178 178 166 202 202 166 214 202 166 166 220 172 178 172 166 172 214 178 202 214 220 178 178" },
  { name: "Fireside", codes: "094 130 166 202 208 214 220 226 227 228 229 230 231 231 231 231 231 231 231 231 231 231 231 231 231 231 231 231 231 231 231 231 231" },
  { name: "Autumn", codes: "210 216 223 230 230" },
  { name: "Diamonds", codes: "189 231 195 189 231 195 189 195 195 189 195 231 189 195 189" },
  { name: "Black Diamonds", codes: "060 061 062 063 069 068 104 105 111" },
  { name: "Renn's Armor", codes: "244 103 247 245 246 103 247 248 249 251 250 249 251 250 252 250 251 252 250 252 250 251 249 250 251 249 247 248 248 246 245 103 247 103 244 096 243 096 244 098 096 243 096 098 096 097 098 097 098 097 098 098" },
  { name: "Dusky Mauve", codes: "138 138 174 132 138 132 132 132 138 132 181 168 138 132 168 168 132 168 168 174 138 168 174 174 181 132 168 175 174 132 138 174 174 181 168 174 175 175 174 175 138 168 174 181" },
  { name: "Soft Purple", codes: "183 189 195 231 231" },
  { name: "Lavender", codes: "135 147 129 153 153" },
  { name: "Forget-Me-Nots", codes: "183 189 195" },
  { name: "Vibrant Purple", codes: "055 056 057 093 093" },
  { name: "The Jackal", codes: "242 241 240 239 239 238 238 238 236 236 236 053 053 054 054 055 055 091 091 092 092 093" },
  { name: "Bronze", codes: "231 230 229 228 222 216 215 215" },
  { name: "Copper", codes: "210 216 223 230 224 223 222 223 224" },
  { name: "Light Brown", codes: "180 223 187 252 254 255" },
  { name: "Rabbit Brown", codes: "178 179 179 180 180" },
  { name: "Coffee Liqueur", codes: "058 130 094 100 094 058 094 094 130 130 058 130 094 100 094 130 136 100 094 058 100 100 094" },
  { name: "Bison Brown", codes: "094 136 094 136 094 136" },
  { name: "Coffee Berries", codes: "072 108 150 143 137 131" },
  { name: "Spring Petals", codes: "176 182 188 151 120 078" },
  { name: "Vibrant Petals", codes: "129 128 201 207 213 219 188 151 120 078 077 076" },
  { name: "Juicy Watermelon", codes: "169 169 175 181 187 193 192 154 118 046 040 034 034" },
  { name: "Hydrangeas", codes: "026 032 068 104 140 176 177 213 213" },
  { name: "Faded Glass", codes: "151 152 153 153" },
  { name: "Sea Glass", codes: "077 078 079 080 116 152 116 080 079 078 078" },
  { name: "Serene Sunrise", codes: "214 215 216 217 218 219" },
  { name: "Glorious Sunset", codes: "231 230 229 228 227 226 220 214" },
  { name: "Flames", codes: "196 202 208 214 220 221 228 229 231" },
  { name: "Soft Green to Yellow", codes: "228 228 229 229 230 230 231 195 194 193 192 155 156 156" },
  { name: "Soft Green to Yellow (blend)", codes: "228 229 228 228 229 228 194 229 230 229 230 229 194 229 230 231 230 230 231 230 231 195 231 195 231 195 194 193 194 193 192 193 192 159 155 159 156 155 156 192 159 156 155 192" },
  { name: "Soft Blue to Green", codes: "117 123 159 195 231 231 194 193 192 155" },
  { name: "Dark Green to Blue", codes: "022 023 022 023 024 023 024 025 024 025 026 027 026 027 033 027 033 026 033 027 027 033 039 045 039 045" },
  { name: "Green to Brown", codes: "023 029 065 101 137" },
  { name: "Warm Autumn", codes: "126 162 198 204 210 216 223 230" },
  { name: "Grey to Brown Blend", codes: "253 251 253 252 250 252 251 249 251 250 248 250 249 247 249 248 250 248 245 247 245 244 246 244 243 242 094 243 094 242 094 240 094 136 094 136 094 136 094" },
  { name: "Grey to Autumn Blend", codes: "254 252 254 253 251 253 252 250 252 251 249 251 250 248 250 249 247 249 248 250 249 250 251 249 250 248 249 247 246 248 210 216 210 223 216 230 223 230 223 216 223 216 210" },
  { name: "Grey to Sage Green Blend", codes: "254 253 251 253 252 250 252 251 249 251 250 248 250 249 247 249 248 250 248 245 247 245 244 246 244 243 242 065 243 066 242 065 242 064 065 064 065 064 065 064 065 066 065 066" },
  { name: "Blue - Green - Yellow", codes: "117 123 159 195 194 193 192 155 156 191 227 228 229" },
  { name: "Soft Pastels", codes: "225 224 230 194 195 189 219 218 229 193 159 183" },
  { name: "Soft Coral", codes: "224 223 224 225 189 153 159 195 194 230" },
  { name: "Rainbow", codes: "161 162 163 169 175 181 187 193 192 154 118 121 120 121 122 123 117 111 105 099 063 057" },
  { name: "Jeweled Beads", codes: "210 216 223 230 224 223 222 223 224 181 182 189 182 189 195 189 195 189 153 189 153 117 153 117 116 117 116 115 116 115 109 115 109 109" },
];

/** Built-in HTML (truecolour) gradient presets, each a space-separated #rrggbb list. */
export const HTML_PRESETS: GradientPreset[] = [
  { name: 'Aurora', codes: '#0b486b #3b8686 #79bd9a #a8dba8 #cff09e' },
  { name: 'Ember', codes: '#2b0a00 #641e00 #b33000 #ff6b00 #ffb300 #ffe066' },
  { name: 'Ocean', codes: '#012a4a #013a63 #01497c #2a6f97 #61a5c2 #a9d6e5' },
  { name: 'Sunset', codes: '#355070 #6d597a #b56576 #e56b6f #eaac8b #ffd6a5' },
  { name: 'Rainbow', codes: '#e63946 #f3722c #f9c74f #90be6d #43aa8b #577590 #9d4edd' },
  { name: 'Blood', codes: '#2b0000 #4a0000 #800000 #b30000 #e60000 #ff1a1a' },
  { name: 'Spring', codes: '#d8f3dc #b7e4c7 #95d5b2 #74c69d #52b788 #40916c' },
  { name: 'Moonlit', codes: '#0b1026 #1b2a4a #2e4374 #4a6fa5 #7f9cc9 #c5d8f0' },
  { name: 'Bubblegum', codes: '#ffd6ff #e7c6ff #c8b6ff #b8c0ff #bbd0ff' },
  { name: 'Vampire', codes: '#10002b #240046 #3c096c #5a189a #7b2cbf #9d4edd' },
];
