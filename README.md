# Lantern

<!-- sidebar: the ‹ / 🏮 toggle cycles full → icon rail → hidden; the state is remembered. -->

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
- `shared/types.ts` — the world profile and its triggers, aliases, timers and channel tabs (used by both processes)
- `src/` — React UI: `lib/ansi.ts` (colour parser), `lib/store.ts` (session state, runs triggers, timers and scripts, routes lines to channel tabs, writes the log), `lib/automation.ts` (matching engine, alias/speedwalk expansion), `lib/channels.ts` (channel-tab routing and the Haven preset), `lib/lua.ts` (the Lua API and one state per session), `lib/lua-wasm.ts` (loads wasmoon), `components/`
- `scripts/` — `probe.mjs <host> <port>` checks telnet negotiation; `test-ansi.mjs` unit-tests the colour parser; `test-automation.mjs` unit-tests triggers, aliases, timers and `.MCL` import; `test-channels.mjs` unit-tests channel-tab routing and world normalisation; `test-lua.mjs` unit-tests the Lua layer under Node

Your data is in `%APPDATA%\lantern\`: `worlds.json` (profiles, including script variables), `scripts\<worldId>.lua` (one Lua script per world) and `logs\` (one plain-text file per world per day).

## Smoke test

Connects to a login screen, screenshots the window and quits:

```bash
LANTERN_SMOKE="aardwolf.org|4000|C:\path\to\out.png" npx electron .
```

Smoke runs use a throwaway profile and never touch your worlds or logs. The smoke world carries a demo highlight trigger, a one-shot note trigger that also calls a Lua function, a Lua script, an alias and an `OOC` channel tab, so the screenshot also exercises automation, scripting and capture. Set `LANTERN_SMOKE_PANEL=1` to screenshot with the Automation panel open (`=script` or `=channels` opens it on that tab), `LANTERN_SMOKE_VIEW=OOC` to screenshot the channel tab instead of Main, and `LANTERN_SMOKE_WAIT=<ms>` to wait longer before the capture.

## Display settings and quick highlights

⚙ Settings (sidebar) sets the font, size and line spacing of the output pane and the command box separately, plus the output width (characters per line; 0 fills the window), background colour (Theme, Black, or any colour), the ANSI colour palette (Warm, Classic/MUSHclient, or custom), spell-check dictionaries, and a scroll-to-new-output toggle; the command box also has a resting height in lines and you can drag its top edge. Settings live in `%APPDATA%\lantern\settings.json`. ✎ Highlight (or Ctrl+Alt+H) adds a colour-only trigger for a word or phrase, pre-filled with any text selected in the output; it lands in the "Highlights" trigger group. Settings also has an "Echo my commands" switch; when on, the echo appears in the pane you typed from, so a command typed on a channel tab shows up in that tab. Settings › Colours also has Custom colours: up to ten named text/background colours, separate from the ANSI palette, that appear as one-click chips when you pick a trigger's colour. A trigger linked to a custom colour follows it: edit the colour once and every trigger using it updates (for lines from then on). Triggers can now set a background colour as well as text. Colour choices everywhere use a picker with palette swatches and an OS colour dialog for custom colours.

## Automation

Each group chip has a × to delete the whole group at once; the Delete button under the list removes the selected item. Open ⚡ Automation from the tab bar (or the ⚡ on a world in the sidebar). Triggers watch each finished line of output and can recolour it, hide it, or send something back; aliases rewrite what you type; timers send on a schedule while connected. Plain patterns match anywhere in the line, `*` is a wildcard (and then the pattern must match the whole line); regex patterns are JavaScript regular expressions. `%1`–`%9` are the captures, `%0` the whole match. In the Triggers, Aliases and Timers tabs, Import… reads a MUSHclient export (.mct triggers, .mca aliases, .mcm timers, or .xml) or world file (.MCL) and Paste XML takes what MUSHclient's Copy button put on the clipboard; imported items are added to the list and kept when you Save. Each channel tab can set extra space between its messages for easier reading. A tab can also capture the replies to commands (a Help tab for `help …`, via "Capture replies to commands matching"): everything after a matching command goes to the tab until the output goes quiet or you send another command. Command stacking and speedwalk live under Options and are off unless you turn them on for a world.

## Channel tabs

A world can have channel tabs: capture panes that keep chatter off the roleplay screen. Each tab has a name and a list of regex patterns; every finished line is tested after triggers have run, tabs in order and patterns in order, and the first match wins. A `capture` pattern moves the line to that tab (or copies it, if the tab keeps a copy in Main); a `silence` pattern drops the line everywhere, for noise like the bare `[AFK]` line Haven prints while you are away. A line a trigger gags never reaches a tab. A tab can also carry a command prefix (say `ooc `): while that tab is showing, whatever you type is sent with the prefix in front, and the input bar shows it as a chip. Start a command with `\` to send it without the prefix once.

When a world has tabs, a strip of sub-tabs appears under the session tabs: `Main` plus one per tab. Click to switch panes (the input box always sends to the game), hover to peek at the last three lines, and watch the dot and count for lines that arrived while you were elsewhere. Each tab keeps its own 5,000-line scrollback, scroll-lock and timestamps. Set them up on the Channels tab of the Automation panel, which has a Try-it box and a one-click "Add Haven channel tabs" preset (`[OOC]`, `[Guide]`, `[Newbie]`, `[HeyThere]`). The daily log still records every line in order, with captured lines prefixed `[tab name]`. Details in `docs/channel-tabs.md`.

## Scripting

Each world has one Lua 5.4 script, on the Script tab of the Automation panel (or "Open in editor" to use your own editor; press Reload after saving there). It runs in its own state for every session on that world, loaded when you connect and thrown away when you close the tab; Save and Reload start a fresh state. Lua runs inside the app window (wasmoon, Lua compiled to WebAssembly), so a script sees only this client's API, not your files.

A trigger, alias or timer can name a function from the script; it is called after the item's send as `fn(name, line, wildcards)`, where `wildcards[0]` is the whole match, `wildcards[1]`… the captures, and named regex groups are `wildcards.name`. Each item can also carry inline Lua (what MUSHclient calls "send to script"): `%1`–`%9` are substituted into the text first and `local name, line, wildcards = ...` picks up the rest. Errors show as red lines in the output; a call that runs for more than five seconds is stopped.

The API is a familiar subset of MUSHclient's, available as globals and again as `world.*`:

- Output and input: `Send(text)` (echoed, like a trigger's send), `Execute(text)` (goes through aliases, stacking and speedwalk), `Note(...)`, `ColourNote(fg, bg, text, ...)`, `Tell(...)`, `ColourTell(...)`, `print(...)`. Colours are CSS colours (`"red"`, `"#ffcc00"`), `""` for the default.
- Variables, saved with the world: `GetVariable(name)` (nil when unset), `SetVariable(name, value)`, `DeleteVariable(name)`, `GetVariableList()`.
- Automation: `AddTrigger(name, match, response, flags, colour, wildcard, sound, script)`, `AddTriggerEx(…, sendTo)`, `AddAlias(name, match, response, flags, script)`, `AddTimer(name, hour, minute, second, response, flags, script)`, `DeleteTrigger/DeleteAlias/DeleteTimer(name)`, `EnableTrigger/EnableAlias/EnableTimer(name, on)`, `EnableGroup(group, on)` and `EnableTriggerGroup`/`EnableAliasGroup`/`EnableTimerGroup`, `IsTrigger/IsAlias/IsTimer(name)`. Flags are the MUSHclient bit values in `trigger_flag`, `alias_flag` and `timer_flag` (`Enabled`, `RegularExpression`, `IgnoreCase`, `OmitFromOutput`, `OneShot`, `Temporary`, `AtTime`, `TimerNote`…); `sendto.world`, `sendto.output` and `sendto.script` are honoured. Adding a name that already exists replaces it, so a script can set its items up on every load. Items added with `Temporary` are not saved to disk. Calls return 0 or a code from `error_code`; `check(code)` raises an error on anything but 0.
- About the world: `GetInfo(1)` host, `GetInfo(2)` or `WorldName()` name, `GetInfo(4)` port, `GetInfo(106)` or `IsConnected()` connected; `utils.timer()` seconds since the state started; Lua's own `os.time`, `os.date`, `string`, `table` and `math` libraries.

See `ROADMAP.md` for what comes next.
