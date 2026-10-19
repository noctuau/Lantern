# Lantern roadmap

Built in stages so each session is a bounded chunk of work. Stages 1 and 2 are done.

## Stage 1 — Connect and read (done 2026-10-20)

- Electron + React + Vite + TypeScript scaffold
- Telnet engine: option negotiation, MCCP2 compression, GMCP, TTYPE/MTTS, NAWS, ECHO (password masking), EOR/GA prompts
- Streaming ANSI parser: 16 colours, 256 colours, truecolour, bold/italic/underline, sequences split across packets
- World profiles (add, edit, delete), import from MUSHclient `.MCL`, auto-send on connect
- Tabs for multiple sessions with unread badges
- Output pane with scroll-lock and "jump to latest", clickable URLs
- Multi-line input (Shift+Enter), command history, Escape to clear
- Plain-text session logs per world per day
- Smoke-test mode and an ANSI parser unit test

## Stage 2 — Automation core (done 2026-10-20)

- Triggers (regex + plain with `*` wildcards), aliases (regex, wildcard, or command prefix), timers (interval or daily clock time), stored per world in `worlds.json`
- Gags, highlights (matched text or whole line, ANSI palette or custom colour), one-shot triggers and timers, groups with one-click on/off
- `%0`–`%9` substitution, multi-line sends, "send to output as a note"
- Command stacking and speedwalk (both optional, off by default, per world)
- Automation panel per world (⚡ in the tab bar or sidebar) with a "Try it" box for triggers and aliases; status-bar pause switch
- Import triggers, aliases and timers from `.MCL` (match, regexp, enabled, group, ignore_case, omit_from_output, one_shot, custom_colour / other_text_colour, send_to, at_time, sequence, command stacking and speedwalk settings)
- Each trigger/alias/timer carries an optional Lua function name (`script`) and any inline Lua from MUSHclient (`scriptBody`) for stage 3; neither runs yet
- Unit test `scripts/test-automation.mjs`
- Not done: keypad / function-key macros (moved to stage 5 alongside the settings UI)

## Stage 3 — Lua scripting

- Lua 5.4 via wasmoon, one state per world
- Core API in the spirit of MUSHclient's: `Send`, `Note`, `ColourNote`, `Execute`, `AddTrigger`, `AddAlias`, `AddTimer`, `GetVariable`/`SetVariable`, `world.*`
- Script file per world, reload on save
- Triggers/aliases/timers can call Lua functions

## Stage 4 — Plugins

- Plugin = folder with `plugin.json` + `main.lua` (plus a shim that loads the common MUSHclient XML plugin shape)
- Sandboxed state per plugin, enable/disable, plugin list UI
- Hooks: on connect/disconnect, on line, on send, on GMCP, on prompt
- Port the one plugin Noctua uses

## Stage 5 — Modern-era features

- Settings UI: fonts (monospace or proportional for RP), size, line spacing, themes (light + dark + custom palettes)
- Keypad / function-key macros
- Spell check in the input box (Chromium gives this nearly free)
- Pose composer: a larger writing pane for long RP poses, with a preview
- Searchable scrollback and log viewer inside the app
- Split-view and detachable windows per character
- Notifications when your name is mentioned or a tab you are not watching gets activity
- GMCP-driven panels (vitals, room, who) for games that send them
- Secure storage for passwords (Electron `safeStorage`) instead of plain text in `worlds.json`
- Installer via `electron-builder` and auto-update

## Later / ideas

- MXP and Pueblo link support (MUSHes still send Pueblo)
- MSP sounds
- Shared timers and reminders across worlds
- AresMUSH web-portal integration for games that have one
