# Lantern roadmap

Built in stages so each session is a bounded chunk of work. Stages 1 to 3 are done.

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

## Stage 3 — Lua scripting (done 2026-10-20)

- Lua 5.4 via wasmoon, one state per session, created on connect and closed with the tab; runs in the renderer with `glue.wasm` inlined as a data: URI so the packaged (file://) app can load it
- Core API in the spirit of MUSHclient's, as globals and under `world`: `Send`, `Execute`, `Note`, `ColourNote`, `Tell`, `ColourTell`, `GetVariable`/`SetVariable`/`DeleteVariable`/`GetVariableList`, `AddTrigger`/`AddTriggerEx`/`AddAlias`/`AddTimer`, `Delete*`, `Enable*`, `EnableGroup` (+ per-kind), `Is*`, `GetInfo`, `WorldName`, `IsConnected`, `print`, `utils.timer`, `check`, and the `trigger_flag`/`alias_flag`/`timer_flag`/`sendto`/`error_code` tables
- Variables persist per world in `worlds.json`; items a script adds with the Temporary flag never reach disk
- Triggers, aliases and timers call their Lua function as `fn(name, line, wildcards)` and/or run their inline Lua (`scriptBody`, MUSHclient's "send to script") after their send
- Script file per world in `%APPDATA%\lantern\scripts\<worldId>.lua`; Script tab on the Automation panel with Save (reloads), Reload and Open in editor; errors are red lines in the output; runaway calls are stopped after 5 s
- Unit test `scripts/test-lua.mjs` (wasmoon under Node)
- Not done: `SetTriggerOption`/`GetTriggerInfo` and friends, `expand_variables`, send-to-variable, sounds; a `/lua` command line in the input box; the smoke profile still persists between runs

## Channel tabs (done 2026-10-20)

- Capture panes per world (`World.channelTabs`): regex patterns in tab order, `capture` moves a line to the tab (or copies it with keep-in-main), `silence` drops it everywhere; triggers run first and a gagged line never reaches a tab. Spec and as-built notes in `docs/channel-tabs.md`
- Sub-tab strip under the session tabs (`Main` + one per enabled tab) with unread dot and count, hover peek of the last three lines, per-pane scrollback (5,000 lines), scroll-lock and timestamps; the input bar always talks to the game
- Channels editor in the Automation panel with a Try-it box, and a one-click "Add Haven channel tabs" preset (`[OOC]`, `[Guide]`, `[Newbie]`, `[HeyThere]` captured, bare `[AFK]` silenced)
- Daily logs now written line by line from the renderer, captured lines prefixed `[tab name]`
- Unit test `scripts/test-channels.mjs`; `LANTERN_SMOKE_VIEW` / `LANTERN_SMOKE_PANEL=channels` for screenshots
- Per-tab command prefix (`ChannelTab.commandPrefix`, same day): typing on a tab that has one sends `prefix + text` through aliases, stacking and speedwalk; `\` at the start skips it once; a chip in the input bar shows it; echo and log show what was sent, ↑ recalls what was typed. The Haven preset ships without one (the old OOC world redirected commands rather than prefixing them)

## Stage 4 — Plugins

- Plugin = folder with `plugin.json` + `main.lua` (plus a shim that loads the common MUSHclient XML plugin shape)
- Sandboxed state per plugin, enable/disable, plugin list UI
- Hooks: on connect/disconnect, on line, on send, on GMCP, on prompt
- Port the one plugin Noctua uses

## Polish (done 2026-10-20, from first hands-on use)

- Colour picker with palette swatches and OS colour dialog; sample text beside it
- Settings dialog: fonts, sizes and line spacing for output and command box, resting height of the command box (also draggable)
- Quick "Highlight word or phrase" dialog on Ctrl+Alt+H / ✎ Highlight, creating a trigger in the Highlights group
- Smoke-test windows no longer take keyboard focus
- Font picker over the installed fonts (asked of Windows via .NET), each drawn in its own face, with a monospace-only filter
- Scroll-to-new-output toggle; removed the content-visibility estimate that made follow-at-bottom jumpy
- ANSI palette presets (Warm / Classic-MUSHclient / readable-VGA) and full 16-colour custom editor
- Spell check: choose dictionaries (defaults to en-AU), personal dictionary, right-click suggestions
- Output width (wrap column, also sent to the game via NAWS)
- Output pane background colour (Theme / Black / custom); per-channel-tab message spacing
- Echo-my-commands switch; the echo lands in the pane it was typed from (channel tab or Main)
- Per-world logging settings: what to log, plain text or HTML with colours, header on/off, file name pattern with strftime fields and Browse…; imported from .MCL

## Stage 5 — Modern-era features

- Themes (light + dark + custom palettes)
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
