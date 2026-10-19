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
- `src/` — React UI: `lib/ansi.ts` (colour parser), `lib/store.ts` (session state, runs triggers and timers), `lib/automation.ts` (matching engine, alias/speedwalk expansion), `components/`
- `scripts/` — `probe.mjs <host> <port>` checks telnet negotiation; `test-ansi.mjs` unit-tests the colour parser; `test-automation.mjs` unit-tests triggers, aliases, timers and `.MCL` import

Your data is in `%APPDATA%\lantern\`: `worlds.json` (profiles) and `logs\` (one plain-text file per world per day).

## Smoke test

Connects to a login screen, screenshots the window and quits:

```bash
LANTERN_SMOKE="aardwolf.org|4000|C:\path\to\out.png" npx electron .
```

Smoke runs use a throwaway profile and never touch your worlds or logs. The smoke world carries a demo highlight trigger, a one-shot note trigger and an alias, so the screenshot also exercises automation. Set `LANTERN_SMOKE_PANEL=1` to screenshot with the Automation panel open, and `LANTERN_SMOKE_WAIT=<ms>` to wait longer before the capture.

## Automation

Open ⚡ Automation from the tab bar (or the ⚡ on a world in the sidebar). Triggers watch each finished line of output and can recolour it, hide it, or send something back; aliases rewrite what you type; timers send on a schedule while connected. Plain patterns match anywhere in the line, `*` is a wildcard (and then the pattern must match the whole line); regex patterns are JavaScript regular expressions. `%1`–`%9` are the captures, `%0` the whole match. Command stacking and speedwalk live under Options and are off unless you turn them on for a world.

See `ROADMAP.md` for what comes next.
