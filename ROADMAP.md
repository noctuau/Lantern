# Lantern roadmap

Built in stages so each session is a bounded chunk of work. Stage 1 is done.

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

## Stage 2 — Automation core

- Triggers (regex + plain), aliases, timers, with per-world persistence
- Gags, highlights, one-shot triggers, trigger groups
- Command stacking and speedwalk (both optional, off by default)
- Keypad / function-key macros
- Import triggers, aliases and timers from `.MCL`

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
