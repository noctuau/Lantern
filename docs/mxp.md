# MXP

Added 2026-10-21. Haven's italics (`` `2 … `5 `` format codes, sent correctly by Chat markup) never showed on screen. A raw log of an emote test showed Haven stripping the codes entirely for Lantern, while the same Haven worlds in MUSHclient showed italics. Haven negotiates no telnet options at the login screen, but offers MXP (telnet option 91) after login; MUSHclient accepts it by default (`use_mxp` absent = "query"), Lantern used to refuse every unknown option with IAC DONT/WONT, and Haven only sends formatting tags to a client that accepted.

## What the spec says (zuggsoft.com/zmud/mxp.htm) and what Lantern does

- **Negotiation.** The server sends `IAC DO MXP` or `IAC WILL MXP`; the client answers `IAC WILL MXP` / `IAC DO MXP`. `electron/telnet.ts` does that when `TelnetOptions.mxp` is true, emits `mxp` once, and notes every option a server offers ("Server asked for MXP (91): enabled", "Server offered ZMP (93): not supported", "…declined (MXP formatting is off for this world)"), one note per option, ECHO excluded because it flips on every password prompt.
- **Line modes** are `ESC [ N z`: 0 open (only B, I, U, S, H, COLOR/C, FONT and their aliases are tags; any other `<` is text), 1 secure (all tags), 2 locked (no tags, no entities), 3 reset (closes everything, SGR 0, back to open as default), 4 secure for the next tag only (and that tag's close), 5/6/7 make open/secure/locked the default, 10/11/12 room name/description/exits, 19 welcome text, 20–99 game-specific; Lantern treats 10 and up as secure lines. A newline puts the mode back to the default and closes any formatting left open on an open line (specific off codes, so ANSI colours the game set are untouched).
- **Tags** → ANSI (`src/lib/ansi.ts` renders them): B/BOLD/STRONG/H/HIGH → 1/22, I/ITALIC/EM → 3/23, U/UNDERLINE → 4/24, S/STRIKE/STRIKEOUT → 9/29, COLOR/C fore back (named or positional) and FONT color back → truecolour 38;2 / 48;2, restored to the enclosing colour or 39/49 on close, A href → underlined text plus ` [url]` when the URL is not already the text, SEND href → underlined text (the command is not clickable yet), BR/HR → newline, SBR → space, P → newlines inside become spaces, NOBR → the next newline is dropped, VERSION → reply, SUPPORT → reply, `<!ELEMENT name "<COLOR red><B>" …>` → remembered and expanded when `<name>` / `</name>` arrive. Every other tag (VAR, EXPIRE, IMAGE, SOUND, MUSIC, GAUGE, STAT, FRAME, DEST, FILTER, RELOCATE, USER, PASSWORD, RName…, comments, `<!ENTITY>`, `<!ATTLIST>`) is dropped and its text kept.
- **Replies** go out as secure lines: `ESC[1z<VERSION MXP=1.0 STYLE=1.0 CLIENT=Lantern VERSION=<app version> REGISTERED=yes>` and `ESC[1z<SUPPORTS +b +i +u …>` (the list in `SUPPORTED`; a `<SUPPORT image +send>` query is answered per item with + or −).
- **Entities** `&lt; &gt; &amp; &quot; &apos; &nbsp; &#NN; &#xHH;` and a few typographic ones in open and secure lines; unknown names stay as typed.
- **Streaming.** An unfinished tag, entity or escape at the end of a packet is held for the next one (a tag longer than 4 KB, or one with a newline before its `>`, was never a tag). A `>` inside quotes does not end a tag. A split SGR (`ESC[3` + `1m`) is reassembled, not lost.

## Where it lives

- `shared/mxp.ts`: `MxpFilter` (`on` flag set from the telnet `mxp` event; `feed(chunk)` returns `text`, `send` and `info` events; `flush()` at disconnect), `parseArgs`, `SUPPORTED`. Pure TypeScript, shares `decodeEntity`, `cssColour` and `fgSgr` with `shared/pueblo.ts`.
- `electron/main.ts` `session:connect`: raw log → `MxpFilter` → `PuebloFilter` → renderer; `send` events go to the game, `info` events become notes.
- `World.mxp` in `shared/types.ts` (default true; `pueblo: false` from the one unreleased commit under the old name still turns it off), checkbox in `WorldEditor.tsx`, `.MCL` import of `use_mxp` ("3" = never → off) in `electron/mcl.ts`.
- Tests: `node scripts/test-mxp.mjs` (modes, tags, replies, elements, splits, telnet negotiation through a stubbed socket). Smoke: `node scripts/fake-mxp.mjs 4101` then `LANTERN_SMOKE="127.0.0.1|4101|out.png" npx electron .`; the fake offers `IAC DO MXP`, waits for `WILL`, and sends open- and secure-mode lines, a locked line, a user element, a split tag and VERSION/SUPPORT requests (its console shows Lantern's replies).

## Not done

Clickable `<SEND>` commands and hover hints, `<IMAGE>`, `<SOUND>`, gauges and stats, `<VAR>` values and `<!ENTITY>` substitution, `<FRAME>`/`<DEST>` panes, `<P>` word-wrapping rules.
