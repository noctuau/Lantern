# Lantern

A modern MUD/MUSH client: a fresh take on MUSHclient, built for roleplay games.

## Run it

```bash
npm start
```

Or double-click `Lantern.cmd`. The first run builds the app, later runs are quick.

For live-reload development:

```bash
npm run dev
```

## Where things live

- `electron/` — main process: `telnet.ts` (protocol engine), `worlds.ts` (world profiles), `mcl.ts` (MUSHclient import), `main.ts` (window, IPC, logging)
- `shared/types.ts` — the world profile and its triggers, aliases and timers (used by both processes)
- `src/` — React UI: `lib/ansi.ts` (colour parser), `lib/store.ts` (session state, runs triggers, timers and scripts), `lib/automation.ts` (matching engine, alias/speedwalk expansion), `lib/lua.ts` (the Lua API and one state per session), `lib/lua-wasm.ts` (loads wasmoon), `components/`
- `scripts/` — `probe.mjs <host> <port>` checks telnet negotiation; `test-ansi.mjs` unit-tests the colour parser; `test-automation.mjs` unit-tests triggers, aliases, timers and `.MCL` import; `test-lua.mjs` unit-tests the Lua layer under Node

Your data is in `%APPDATA%\lantern\`: `worlds.json` (profiles, including script variables), `scripts\<worldId>.lua` (one Lua script per world) and `logs\` (one plain-text file per world per day).

## Smoke test

Connects to a login screen, screenshots the window and quits:

```bash
LANTERN_SMOKE="aardwolf.org|4000|C:\path\to\out.png" npx electron .
```

Smoke runs use a throwaway profile and never touch your worlds or logs. The smoke world carries a demo highlight trigger, a one-shot note trigger that also calls a Lua function, a Lua script and an alias, so the screenshot also exercises automation and scripting. Set `LANTERN_SMOKE_PANEL=1` to screenshot with the Automation panel open (`=script` opens it on the Script tab), and `LANTERN_SMOKE_WAIT=<ms>` to wait longer before the capture.

## Automation

Open ⚡ Automation from the tab bar (or the ⚡ on a world in the sidebar). Triggers watch each finished line of output and can recolour it, hide it, or send something back; aliases rewrite what you type; timers send on a schedule while connected. Plain patterns match anywhere in the line, `*` is a wildcard (and then the pattern must match the whole line); regex patterns are JavaScript regular expressions. `%1`–`%9` are the captures, `%0` the whole match. Command stacking and speedwalk live under Options and are off unless you turn them on for a world.

## Scripting

Each world has one Lua 5.4 script, on the Script tab of the Automation panel (or "Open in editor" to use your own editor; press Reload after saving there). It runs in its own state for every session on that world, loaded when you connect and thrown away when you close the tab; Save and Reload start a fresh state. Lua runs inside the app window (wasmoon, Lua compiled to WebAssembly), so a script sees only this client's API, not your files.

A trigger, alias or timer can name a function from the script; it is called after the item's send as `fn(name, line, wildcards)`, where `wildcards[0]` is the whole match, `wildcards[1]`… the captures, and named regex groups are `wildcards.name`. Each item can also carry inline Lua (what MUSHclient calls "send to script"): `%1`–`%9` are substituted into the text first and `local name, line, wildcards = ...` picks up the rest. Errors show as red lines in the output; a call that runs for more than five seconds is stopped.

The API is a familiar subset of MUSHclient's, available as globals and again as `world.*`:

- Output and input: `Send(text)` (echoed, like a trigger's send), `Execute(text)` (goes through aliases, stacking and speedwalk), `Note(...)`, `ColourNote(fg, bg, text, ...)`, `Tell(...)`, `ColourTell(...)`, `print(...)`. Colours are CSS colours (`"red"`, `"#ffcc00"`), `""` for the default.
- Variables, saved with the world: `GetVariable(name)` (nil when unset), `SetVariable(name, value)`, `DeleteVariable(name)`, `GetVariableList()`.
- Automation: `AddTrigger(name, match, response, flags, colour, wildcard, sound, script)`, `AddTriggerEx(…, sendTo)`, `AddAlias(name, match, response, flags, script)`, `AddTimer(name, hour, minute, second, response, flags, script)`, `DeleteTrigger/DeleteAlias/DeleteTimer(name)`, `EnableTrigger/EnableAlias/EnableTimer(name, on)`, `EnableGroup(group, on)` and `EnableTriggerGroup`/`EnableAliasGroup`/`EnableTimerGroup`, `IsTrigger/IsAlias/IsTimer(name)`. Flags are the MUSHclient bit values in `trigger_flag`, `alias_flag` and `timer_flag` (`Enabled`, `RegularExpression`, `IgnoreCase`, `OmitFromOutput`, `OneShot`, `Temporary`, `AtTime`, `TimerNote`…); `sendto.world`, `sendto.output` and `sendto.script` are honoured. Adding a name that already exists replaces it, so a script can set its items up on every load. Items added with `Temporary` are not saved to disk. Calls return 0 or a code from `error_code`; `check(code)` raises an error on anything but 0.
- About the world: `GetInfo(1)` host, `GetInfo(2)` or `WorldName()` name, `GetInfo(4)` port, `GetInfo(106)` or `IsConnected()` connected; `utils.timer()` seconds since the state started; Lua's own `os.time`, `os.date`, `string`, `table` and `math` libraries.

See `ROADMAP.md` for what comes next.
