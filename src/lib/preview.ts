/**
 * Render the line you're about to send the way the game will show it — the command box's in-game
 * preview (InputBar's 👁 toggle). It resolves the same backtick codes the colour composer and the
 * chat-markup option emit — `#rrggbb and `NNN colours, plus the world's bold / italic / underline
 * toggles — expands Haven's @me / @my / @line tokens, prepends your name to a pose (emote / pose / :
 * / ;), turns %r into a real line break, and (a MUD convention) paints "double-quoted speech" the
 * world's speech colour unless a colour code inside it says otherwise. Pure (no DOM/Electron) so
 * scripts/test-preview.mjs can run it under Node.
 *
 * It does NOT fake the room's wrapper ("Liesel says, …"); it shows your own line with its codes
 * resolved, which is what you want when eyeing a pose before it goes out. The caller runs the same
 * prefix + applyMarkup steps as a real send first, so a pose whose markup WON'T fire (wrong verb,
 * option off) shows its literal asterisks here — the preview tells the truth about what will send.
 * The expansion is display-only: @me and friends are left in the text that actually transmits, so
 * Haven does the real substitution; this only mirrors it for your eyes.
 */
import { EMPTY_STYLE, type Span, type Style } from './ansi';
import type { MarkupSettings } from '../../shared/types';

/** Bright white (xterm 15, via the theme's --ansi-15): the default colour for quoted speech. */
const SPEECH_DEFAULT = '15';

export interface PreviewOpts {
  /** Character name on this world — substituted for Haven's @me (and @my → "<name>'s"). '' leaves the tokens literal. */
  character?: string;
  /** Colour for "double-quoted speech": an xterm code, a CSS colour, or `#rrggbb`. Defaults to bright white. */
  speechColour?: string;
}

/** Parse a composed line into styled spans per display line, resolving Haven's outgoing codes. */
export function renderPreview(text: string, markup: MarkupSettings, opts: PreviewOpts = {}): Span[][] {
  const speechFg = opts.speechColour?.trim() || SPEECH_DEFAULT;
  const name = (opts.character ?? '').trim();

  // Pose verbs put your name in front: emote / pose / : add "Name " (a leading space); ; glues it on
  // for a possessive (";'s hand" -> "Name's hand"). The verb is the command, so it isn't shown. When
  // you place the name yourself with @me / @my, Haven doesn't also auto-add it, so neither do we.
  // Left untouched when no character name is set (there's nothing to prepend).
  let body = text;
  if (name) {
    let kind: 'space' | 'glue' | null = null;
    let rest = text;
    const verb = text.match(/^(?:emote|pose)\b[ \t]*/i);
    if (verb) { kind = 'space'; rest = text.slice(verb[0].length); }
    else if (text.startsWith(':')) { kind = 'space'; rest = text.slice(1); }
    else if (text.startsWith(';')) { kind = 'glue'; rest = text.slice(1); }
    if (kind) {
      body = /@m[ey]\b/i.test(rest)
        ? rest                                                        // @me / @my positions the name
        : kind === 'glue' ? name + rest : `${name} ${rest.replace(/^[ \t]+/, '')}`;
    }
  }

  // Haven's plain-text substitutions, done before the code walk so an expanded name flows through
  // speech colouring too. @line is a hard break that swallows the spaces around it (the game trims
  // them); @me is your name and @my the possessive; %r / %R are MUSH breaks. Word boundary \b so
  // @me doesn't fire inside @meloria; @me / @my stay literal when no character name is set.
  const src = body
    .replace(/%[rR]/g, '\n')
    .replace(/[ \t]*@line\b[ \t]*/gi, '\n')
    .replace(/@my\b/gi, name ? `${name}'s` : '@my')
    .replace(/@me\b/gi, name || '@me');

  const lines: Span[][] = [];
  let spans: Span[] = [];
  let buf = '';
  let colour: string | null = null;              // explicit colour from a code; null = none set
  let bold = false, italic = false, underline = false;
  let speech = false;                            // inside "double quotes"

  const style = (): Style => ({
    ...EMPTY_STYLE,
    fg: colour ?? (speech ? speechFg : null),
    bold, italic, underline,
  });
  const flush = () => { if (buf) { spans.push({ text: buf, style: style() }); buf = ''; } };
  const endLine = () => { flush(); lines.push(spans); spans = []; };

  // The world's configured format toggles, longest code first so a longer code isn't shadowed by a
  // shorter one that is its prefix. Matched before numeric colours so `1..`6 read as the markup
  // toggles (what applyMarkup emits for *bold* etc.), not as xterm colours 1..6.
  const toggles = [
    { code: markup.boldOn, apply: () => { bold = true; } },
    { code: markup.boldOff, apply: () => { bold = false; } },
    { code: markup.italicOn, apply: () => { italic = true; } },
    { code: markup.italicOff, apply: () => { italic = false; } },
    { code: markup.underlineOn, apply: () => { underline = true; } },
    { code: markup.underlineOff, apply: () => { underline = false; } },
  ].filter((t) => !!t.code).sort((a, b) => b.code.length - a.code.length);

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { endLine(); i++; continue; }
    // A quote mark belongs to the speech it opens or closes, so flush around it to colour it too.
    if (ch === '"' || ch === '“' || ch === '”') {
      if (!speech) { flush(); speech = true; buf += ch; }
      else { buf += ch; flush(); speech = false; }
      i++; continue;
    }
    if (ch === '`') {
      const rest = src.slice(i);
      const hexm = rest.match(/^`#[0-9a-fA-F]{6}/);               // `#rrggbb truecolour
      if (hexm) { flush(); colour = hexm[0].slice(1).toLowerCase(); i += hexm[0].length; continue; }
      // a configured format toggle — but `1 must not eat the first digit of a colour like `135
      const tog = toggles.find((t) => {
        if (!rest.startsWith(t.code)) return false;
        const after = rest[t.code.length];
        return !(/\d$/.test(t.code) && after !== undefined && /\d/.test(after));
      });
      if (tog) { flush(); tog.apply(); i += tog.code.length; continue; }
      const num = rest.match(/^`(\d{1,3})/);                     // `NNN xterm colour (1-3 digits)
      if (num) { flush(); colour = num[1]; i += num[0].length; continue; }
      const letter = rest[1];                                    // `<letter> resets colour (like `w)
      if (letter && /[a-zA-Z]/.test(letter)) { flush(); colour = null; i += 2; continue; }
      buf += ch; i++; continue;                                  // a lone backtick: keep as text
    }
    buf += ch; i++;
  }
  endLine();
  return lines;
}
