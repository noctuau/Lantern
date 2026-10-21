# Lantern

<!-- sidebar: the ‹ / 🏮 toggle cycles full → icon rail → hidden; the state is remembered. -->

A modern MUD/MUSH client: a fresh take on MUSHclient, built for roleplay games. Lantern is a free, open-source desktop client for Windows that aims to bring the old text-client experience into the modern era.

It's written predominantly for [Haven](https://havenrpg.net) and games built on the same codebase, so it ships with ready-made channel-tab presets for Haven's channels and understands the backtick colour codes those games use. It is not locked to Haven, though: it speaks standard telnet and works with any MUD or MUSH.

## Features

- **Colour** — full ANSI, xterm-256 and truecolour, with a configurable palette (Warm, Classic/MUSHclient, or your own).
- **MXP and Pueblo** — accepts a game's MXP offer (and answers a Pueblo announcement) and renders the italics, bold, underline, colours and links it then sends as tags, which is how Haven and other older MUSHes send formatting. Per world, on by default.
- **Automation** — triggers, aliases and timers, with plain, wildcard or regex matching; recolour a line, hide it, or send a reply.
- **Channel tabs** — route OOC and other chatter into their own tabs to keep it off the roleplay screen, with per-tab timestamps, spacing and a command prefix; one-click Haven preset included.
- **Colour composer** — build gradient or hand-picked coloured text from 87 presets and drop it straight into the command box; select a phrase in the box first and the coloured version replaces it in place. The presets are yours to edit under Settings › Presets (rename, reorder, delete, add, reset to the built-ins), and "Save as preset…" in the composer keeps whatever you have just built.
- **Lua scripting** — a Lua 5.4 script per world with a MUSHclient-style API, sandboxed in the app.
- **MUSHclient import** — read your existing `.MCL` worlds and `.mct`/`.mca`/`.mcm` trigger, alias and timer exports.
- **Comfortable UI** — a collapsible sidebar, separate fonts and sizes for output and input, adjustable width, spell-check, one clean log per day, and quick one-key highlighting.

## Install

Download the latest release from the [Releases page](../../releases) and pick one:

- **`Lantern-<version>-x64.exe`** — the installer. Run it, and later versions install over the top; your worlds and settings are kept.
- **`Lantern-<version>-portable.exe`** — a single file that runs without installing.

Lantern is not code-signed, so Windows SmartScreen shows an "unknown publisher" warning on first run. Choose **More info › Run anyway**. Your worlds, scripts and logs live in `%APPDATA%\Lantern\`, separate from the program, so they survive reinstalls and uninstalls.

### Updating

Settings › About shows the version you are running and has a "Check for updates" button. It looks up the latest release on GitHub and, if it is newer, offers to download the installer (or the portable exe) and start it; your worlds, settings and logs stay where they are. Lantern also checks once a few seconds after it starts and puts a dot on the Settings button when a newer release exists; turn that off on the About tab if you prefer. Nothing is downloaded until you ask.

## Build and run from source

Requires [Node.js](https://nodejs.org/). Then:

```bash
npm install
npm start
```

Or double-click `Lantern.cmd`. The first run builds the app, later runs are quick.

For live-reload development:

```bash
npm run dev
```

To produce the installer and portable `.exe` yourself:

```bash
npm run dist
```

The artifacts land in `release/`.

## Where things live

- `electron/` — main process: `telnet.ts` (protocol engine), `worlds.ts` (world profiles), `mcl.ts` (MUSHclient import), `main.ts` (window, IPC, logging)
- `shared/types.ts` — the world profile and its triggers, aliases, timers and channel tabs (used by both processes)
- `src/` — React UI: `lib/ansi.ts` (colour parser), `lib/store.ts` (session state, runs triggers, timers and scripts, routes lines to channel tabs, writes the log), `lib/automation.ts` (matching engine, alias/speedwalk expansion), `lib/channels.ts` (channel-tab routing and the Haven preset), `lib/lua.ts` (the Lua API and one state per session), `lib/lua-wasm.ts` (loads wasmoon), `components/`
- `scripts/` — `probe.mjs <host> <port>` checks telnet negotiation; `test-ansi.mjs` unit-tests the colour parser; `test-automation.mjs` unit-tests triggers, aliases, timers and `.MCL` import; `test-channels.mjs` unit-tests channel-tab routing and world normalisation; `test-lua.mjs` unit-tests the Lua layer under Node; `test-mxp.mjs` unit-tests MXP negotiation, line modes and tag translation and `test-pueblo.mjs` the Pueblo handshake and tags; `fake-mxp.mjs [port]` and `fake-pueblo.mjs [port]` are tiny games of each kind for smoke runs (`shared/mxp.ts` and `shared/pueblo.ts` are the translators)

Your data is in `%APPDATA%\lantern\`: `worlds.json` (profiles, including script variables), `scripts\<worldId>.lua` (one Lua script per world) and `logs\` (one plain-text file per world per day).

## Smoke test

Connects to a login screen, screenshots the window and quits:

```bash
LANTERN_SMOKE="aardwolf.org|4000|C:\path\to\out.png" npx electron .
```

Smoke runs use a throwaway profile and never touch your worlds or logs. The smoke world carries a demo highlight trigger, a one-shot note trigger that also calls a Lua function, a Lua script, an alias and an `OOC` channel tab, so the screenshot also exercises automation, scripting and capture. Set `LANTERN_SMOKE_PANEL=1` to screenshot with the Automation panel open (`=script`, `=channels` or `=options` opens it on that tab; `=about` opens Settings › About), `LANTERN_SMOKE_VIEW=OOC` to screenshot the channel tab instead of Main, and `LANTERN_SMOKE_WAIT=<ms>` to wait longer before the capture. To smoke Pueblo rendering without a real game, run `node scripts/fake-pueblo.mjs 4100` in one terminal and `LANTERN_SMOKE="127.0.0.1|4100|C:\path\to\out.png" npx electron .` in another: the screenshot should show "You say, *test*" in italics plus bold, underlined, coloured and linked lines.

## MXP and Pueblo

Some MUSHes (Haven among them) never send italics or bold as ANSI codes. Once you log in, Haven offers **MXP** (telnet option 91); a client that accepts gets formatting as tags: `<I>`, `<B>`, `<U>`, `<COLOR>`, `<SEND>`, `<A>` and `&lt;`-style entities, with `ESC[1z`-style line modes saying where tags are allowed. A client that declines gets plain text with the format codes stripped, which is why `*word*` sent through Chat markup showed nothing. Lantern accepts when the world's **MXP formatting** box is ticked (World settings › Connection; on by default, and harmless for games that never offer it): it notes what the server offered ("Server asked for MXP (91): enabled", or "option N: not supported" for anything it does not speak), answers `<VERSION>` and `<SUPPORT>`, expands `<!ELEMENT>` definitions, and turns the tags into the same styles the ANSI parser produces, so triggers, channel tabs and logs see ordinary text. Link and `<SEND>` text is underlined, with a URL after it in brackets; the command behind a `<SEND>` is not clickable yet. Everything else MXP can send (images, sounds, gauges, variables) is dropped with its text kept. The same switch answers the older **Pueblo** handshake (`This world is Pueblo 1.10 enhanced` → `PUEBLOCLIENT`, then `</xch_mudtext>` and HTML-style tags). The raw log format still records exactly what the game sent, tags and mode escapes included. Details in `docs/mxp.md` and `docs/pueblo.md`; `node scripts/fake-mxp.mjs` and `node scripts/fake-pueblo.mjs` run small games of each kind for testing.

## World settings

World settings (✎ on a world in the sidebar) holds the connection (host, port, text encoding, MXP formatting), "Send on connect", logging and notes. **Send on connect** is one command per line, stored as plain text, sent without being echoed to the screen. The lines are held until the game has printed something (or 1.5 s after connecting, whichever comes first) and then go out one every quarter second, so an answer to a question the game asks first, like Haven's "Would you like colour? (Y/n)", lands after the game is listening instead of being swallowed.

## Display settings and quick highlights

⚙ Settings (sidebar) sets the font, weight (Light/Regular/Medium/Semibold/Bold), size and line spacing of the output pane and the command box separately, plus the output width (characters per line; 0 fills the window), background colour (Theme, Black, or any colour), the ANSI colour palette (Warm, Classic/MUSHclient, or custom), spell-check dictionaries, and a scroll-to-new-output toggle; the command box also has a resting height in lines and you can drag its top edge. Settings live in `%APPDATA%\lantern\settings.json`. ✎ Highlight (or Ctrl+Alt+H) adds a colour-only trigger for a word or phrase, pre-filled with any text selected in the output; it lands in the "Highlights" trigger group, and your custom colours appear as one-click chips there too (a highlight linked to one follows later edits to that colour). Settings also has an "Echo my commands" switch; when on, the echo appears in the pane you typed from, so a command typed on a channel tab shows up in that tab. Next to it, "Tidy what I type for the game" (on by default) swaps the punctuation that phones and word processors sneak in for what a MUD expects before a command is sent: curly quotes become straight ones, – and — become - and --, … becomes ..., non-breaking and other odd spaces become a plain space, invisible characters and stray control codes are dropped, full-width letters become ASCII, and accented letters are composed so a latin1 world can encode them. Accented letters, symbols and emoji are otherwise left alone, and passwords are never touched. The tidied text is what gets echoed and what ↑ recalls. Settings › Colours also has Custom colours: up to ten named text/background colours, separate from the ANSI palette, that appear as one-click chips when you pick a trigger's colour. A trigger linked to a custom colour follows it: edit the colour once and every trigger using it updates (for lines from then on). Triggers can now set a background colour as well as text. Colour choices everywhere use a picker with palette swatches and an OS colour dialog for custom colours.

## Automation

Each group chip has a × to delete the whole group at once; the Delete button under the list removes the selected item. The tab strip has a "Hide channels" button that routes everything to Main and hides the channel tabs in one click (for when you are not roleplaying); click "Show channels" to bring them back. It changes nothing in your setup and resets on reconnect. Open ⚡ Automation from the tab bar (or the ⚡ on a world in the sidebar). Triggers watch each finished line of output and can recolour it, hide it, or send something back; aliases rewrite what you type; timers send on a schedule while connected. Plain patterns match anywhere in the line, `*` is a wildcard (and then the pattern must match the whole line); regex patterns are JavaScript regular expressions. `%1`–`%9` are the captures, `%0` the whole match. In the Triggers, Aliases and Timers tabs, Import… reads a MUSHclient export (.mct triggers, .mca aliases, .mcm timers, or .xml) or world file (.MCL) and Paste XML takes what MUSHclient's Copy button put on the clipboard; imported items are added to the list and kept when you Save. Each channel tab can set extra space between its messages for easier reading. A tab can also capture the replies to commands (a Help tab for `help …`, via "Capture replies to commands matching"): everything after a matching command goes to the tab until the output goes quiet or you send another command. Command stacking and speedwalk live under Options and are off unless you turn them on for a world. So is chat markup: with it on, `*italic*`, `**bold**` and `__underline__` in commands that start with a listed verb (say, emote, private, announce, subtle, pose, ooc, chat, tell… or a symbol such as `:`) are sent as the game's format codes (Haven's `` `2 … `5 ``, `` `1 … `4 `` and `` `3 … `6 `` by default, editable per world); `\*` sends a literal star, and anything outside those commands is left exactly as typed.

## Channel tabs

A world can have channel tabs: capture panes that keep chatter off the roleplay screen. Each tab has a name and a list of regex patterns; every finished line is tested after triggers have run, tabs in order and patterns in order, and the first match wins. A `capture` pattern moves the line to that tab (or copies it, if the tab keeps a copy in Main); a `silence` pattern drops the line everywhere, for noise like the bare `[AFK]` line Haven prints while you are away. A line a trigger gags never reaches a tab. A tab can also carry a command prefix (say `ooc `): while that tab is showing, whatever you type is sent with the prefix in front, and the input bar shows it as a chip. Start a command with `\` to send it without the prefix once.

When a world has tabs, a strip of sub-tabs appears under the session tabs: `Main` plus one per tab. Click to switch panes (the input box always sends to the game), hover to peek at the last three lines, and watch the dot and count for lines that arrived while you were elsewhere. The same counts float as pills at the bottom right of the output (above "Jump to latest" when that is showing), one per pane with new lines; click one to go there. Give a tab its own colour in the Channels editor and both its sub-tab and its pill take it, so tabs are told apart at a glance. Each tab keeps its own 5,000-line scrollback, scroll-lock and timestamps. Set them up on the Channels tab of the Automation panel, which has a Try-it box and a one-click "Add Haven channel tabs" preset (`[OOC]`, `[Guide]`, `[Newbie]`, `[HeyThere]`). The daily log still records every line in order, with captured lines prefixed `[tab name]`. Details in `docs/channel-tabs.md`.

## Scripting

Each world has one Lua 5.4 script, on the Script tab of the Automation panel (or "Open in editor" to use your own editor; press Reload after saving there). It runs in its own state for every session on that world, loaded when you connect and thrown away when you close the tab; Save and Reload start a fresh state. Lua runs inside the app window (wasmoon, Lua compiled to WebAssembly), so a script sees only this client's API, not your files.

A trigger, alias or timer can name a function from the script; it is called after the item's send as `fn(name, line, wildcards)`, where `wildcards[0]` is the whole match, `wildcards[1]`… the captures, and named regex groups are `wildcards.name`. Each item can also carry inline Lua (what MUSHclient calls "send to script"): `%1`–`%9` are substituted into the text first and `local name, line, wildcards = ...` picks up the rest. Errors show as red lines in the output; a call that runs for more than five seconds is stopped.

The API is a familiar subset of MUSHclient's, available as globals and again as `world.*`:

- Output and input: `Send(text)` (echoed, like a trigger's send), `Execute(text)` (goes through aliases, stacking and speedwalk), `Note(...)`, `ColourNote(fg, bg, text, ...)`, `Tell(...)`, `ColourTell(...)`, `print(...)`. Colours are CSS colours (`"red"`, `"#ffcc00"`), `""` for the default.
- Variables, saved with the world: `GetVariable(name)` (nil when unset), `SetVariable(name, value)`, `DeleteVariable(name)`, `GetVariableList()`.
- Automation: `AddTrigger(name, match, response, flags, colour, wildcard, sound, script)`, `AddTriggerEx(…, sendTo)`, `AddAlias(name, match, response, flags, script)`, `AddTimer(name, hour, minute, second, response, flags, script)`, `DeleteTrigger/DeleteAlias/DeleteTimer(name)`, `EnableTrigger/EnableAlias/EnableTimer(name, on)`, `EnableGroup(group, on)` and `EnableTriggerGroup`/`EnableAliasGroup`/`EnableTimerGroup`, `IsTrigger/IsAlias/IsTimer(name)`. Flags are the MUSHclient bit values in `trigger_flag`, `alias_flag` and `timer_flag` (`Enabled`, `RegularExpression`, `IgnoreCase`, `OmitFromOutput`, `OneShot`, `Temporary`, `AtTime`, `TimerNote`…); `sendto.world`, `sendto.output` and `sendto.script` are honoured. Adding a name that already exists replaces it, so a script can set its items up on every load. Items added with `Temporary` are not saved to disk. Calls return 0 or a code from `error_code`; `check(code)` raises an error on anything but 0.
- About the world: `GetInfo(1)` host, `GetInfo(2)` or `WorldName()` name, `GetInfo(4)` port, `GetInfo(106)` or `IsConnected()` connected; `utils.timer()` seconds since the state started; Lua's own `os.time`, `os.date`, `string`, `table` and `math` libraries.

See `ROADMAP.md` for what comes next.

## Credits

Lantern is an independent client inspired by [MUSHclient](https://www.gammon.com.au/mushclient) by Nick Gammon, long the standard for MUD/MUSH roleplay. It is a clean reimplementation in TypeScript on Electron, not a fork: it shares none of MUSHclient's source code. For familiarity, its Lua API mirrors a subset of MUSHclient's function names and its `.MCL`/`.mct`/`.mca`/`.mcm` importers read MUSHclient's own export files, so you can carry your triggers, aliases and timers across. MUSHclient and its name belong to Nick Gammon; Lantern is not affiliated with or endorsed by him.

Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), [Vite](https://vite.dev/) and [wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4 in WebAssembly).

## License

[MIT](LICENSE) © 2026 Noctua. Free to use, modify and share; provided as-is, with no warranty.
