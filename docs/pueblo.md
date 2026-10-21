# Pueblo

Added 2026-10-21, after Haven's italics (`` `2 … `5 `` format codes, sent correctly by Chat markup) never showed on screen while MUSHclient displayed them. Haven negotiates no telnet options at the login screen, and Noctua's MUSHclient worlds for Haven all have `pueblo="y"`: Haven sends formatting through Pueblo, not ANSI.

## The protocol, as MUSHclient implements it

Taken from Nick Gammon's source (`doc.h`, `ProcessPreviousLine.cpp`, `doc.cpp`, `mxp/mxpOpenAtomic.cpp`), not from the long-gone Chaco documentation:

1. The game prints a line beginning `This world is Pueblo 1.10 enhanced.` (MUSHclient also recognises `1.0 Enhanced` and `2.50 enhanced`, compared case-insensitively).
2. The client sends the command line `PUEBLOCLIENT 1.10 md5="<32 hex characters>"` (a bare `PUEBLOCLIENT` for 1.0). The hash is random; servers do not check it.
3. The game answers with `</xch_mudtext>`, usually followed by `<img xch_mode=html>`. From `</xch_mudtext>` on, MUSHclient treats the stream as MXP in permanent secure mode: `<tags>` are markup, `&lt;` and friends are characters. There is no way back to literal text short of disconnecting.
4. `<img xch_mode=…>` only changes newline handling: `html` and `text` keep the game's newlines, `purehtml` makes them whitespace so only `<br>` breaks a line. `<br>` is a line break, `<p>` paragraph mode, `<xch_page>` a reset. `<a xch_cmd="…">` is a clickable command, `<a href>` a link, `<img src>` shows as `[url]`. `xch_pane`, `xch_alert`, `html`, `body`, `head`, `title`, `samp`, `center` are ignored.

The brief for this work assumed `<img xch_mode=text>` ends HTML mode. MUSHclient does not do that, so neither does Lantern: once `</xch_mudtext>` arrives, tags are interpreted until the connection closes.

## As built

- `World.pueblo: boolean`, default true (`normalizeWorld` in `shared/types.ts`), imported from a `.MCL` file's `pueblo="y"` / `"n"`. Checkbox under World settings › Connection: "Pueblo (older MUSHes send formatting this way)". A game that never announces Pueblo is unaffected whatever the setting.
- `shared/pueblo.ts` is pure TypeScript: `new PuebloFilter({ enabled, hash })`, `feed(chunk)` returns `text`, `send` and `info` events. `electron/main.ts` runs one per session between the telnet engine and the renderer: the raw diagnostic log is written before the filter (tags verbatim), `send` events go to the game, `info` events become notes in the output ("Pueblo 1.10 offered by the game; replied PUEBLOCLIENT." and "Pueblo on: the game's formatting tags are now rendered.").
- Translation targets the existing ANSI parser (`src/lib/ansi.ts`): `<b>`/`<strong>` → SGR 1/22, `<i>`/`<em>` → 3/23, `<u>` → 4/24, `<font color>` → truecolour 38;2 and 39 (or the enclosing font's colour) on close, `<a>` → underline, with ` [url]` after the text when the href is an http/https/mailto URL not already in the text (the output pane linkifies it), `<br>`, `<p>`, `</p>`, `<hr>` → a newline that swallows one following CR LF so `<br>\r\n` is one break, `<img xch_mode=purehtml>` → bare newlines become spaces, `<xch_page>` → SGR 0 and cleared state. Named colours cover the 16 HTML names plus a few common ones; `#rgb`, `#rrggbb` and bare hex work. Entities: the usual named ones plus `&#NN;` / `&#xHH;`; `&nbsp;` is a plain space.
- Streaming: an unfinished tag, comment or entity at the end of a packet is held until the next one (given up on after 2 KB and shown as text). A `<` that cannot start a tag (`<3`, `a < b`, `</3`) is text. The announcement and the `</xch_mudtext>` marker are also recognised when split across packets.
- Not done: clickable `xch_cmd`/`send` links, images, panes, alerts, `<pre>`/`<p>` word-wrapping rules, MXP's `\e[Nz` line modes.

## Tests

- `node scripts/test-pueblo.mjs`: handshake (all three levels, split announcement, replied once, switch off), the mode switch (split and mixed-case marker, look-alike tag), every tag, nested and stray closes, fonts restoring the outer colour, links, entities, splits across chunks, an ANSI-coloured line with `<i>` through the real parser, and text that merely contains `<`.
- `node scripts/fake-pueblo.mjs 4100` then `LANTERN_SMOKE="127.0.0.1|4100|out.png" npx electron .`: the stand-in game announces Pueblo, waits for `PUEBLOCLIENT`, switches to HTML mode and sends `You say, "<i>test</i>"` plus bold, underline, colour, ANSI-with-italics, link, dropped-tag and split-tag lines; the screenshot must show the italics.
- To confirm against Haven itself: set the Haven world's log format to Raw (World settings › Logging), connect, and read the log in `%APPDATA%\Lantern\logs`; it shows the announcement, `</xch_mudtext>` and the tags exactly as sent.
