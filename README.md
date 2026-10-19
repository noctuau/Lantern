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

- `electron/` — main process: `telnet.ts` (protocol engine), `worlds.ts` (world profiles), `main.ts` (window, IPC, logging)
- `src/` — React UI: `lib/ansi.ts` (colour parser), `lib/store.ts` (session state), `components/`
- `scripts/` — `probe.mjs <host> <port>` checks telnet negotiation; `test-ansi.mjs` unit-tests the colour parser

Your data is in `%APPDATA%\lantern\`: `worlds.json` (profiles) and `logs\` (one plain-text file per world per day).

## Smoke test

Connects to a login screen, screenshots the window and quits:

```bash
LANTERN_SMOKE="aardwolf.org|4000|C:\path\to\out.png" npx electron .
```

Smoke runs use a throwaway profile and never touch your worlds or logs.

See `ROADMAP.md` for what comes next.
