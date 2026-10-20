# Channel tabs (capture panes)

Noctua's request, 2026-10-20. Replaces the MUSHclient hack of a second "OOC" world fed by triggers plus a Redirect_Input plugin (see `Documents\Muds\.Mushclient Worlds\Haven-OOC.xml` and the `[OOC]|[Guide]|[Newbie]` trigger in `Haven Juliet.MCL`).

## What it does

A world can define any number of **channel tabs**. Each tab has a name ("OOC channels", "IC chat channels") and a list of patterns. Every finished line of output is tested against every tab's patterns; matching lines are shown in that tab instead of (or as well as) the main roleplay pane, so the RP screen stays clean.

## Data model (on `World`)

```ts
interface ChannelTab {
  id: string;
  name: string;              // shown on the sub-tab
  enabled: boolean;
  patterns: ChannelPattern[];
  keepInMain: boolean;       // false (default) = lines move to the tab; true = copy, main keeps them
  notify: 'badge' | 'badge+sound' | 'silent';
}

interface ChannelPattern {
  id: string;
  pattern: string;           // JS regex source
  ignoreCase: boolean;
  mode: 'capture' | 'silence';
  // capture  = line goes to the tab (and is removed from main unless keepInMain)
  // silence  = line is dropped from main AND not shown in the tab (for noise like a bare "[AFK]" line)
}
```

Matching uses the plain text of the line (spans joined), same as triggers. Lines keep their ANSI colours in the tab.

Suggested starter patterns, from the screenshots and the old trigger:

- `^\[OOC\] ` (capture)
- `^\[Guide\] ` (capture)
- `^\[Newbie\] ` (capture)
- `^\[HeyThere\] ` (capture)
- `^\[AFK\]\s*$` (silence) — Haven prints an empty `[AFK]` line before each channel message while you are AFK
- `^\[AFK\] (.*)` — when `[AFK]` shares the line with the message, the line itself still matches the channel pattern, so nothing extra is needed

## UI

- **Sub-tab strip** under the session tab bar: `Main` plus one sub-tab per channel tab. Clicking swaps the output pane; the input bar stays the same and always sends to the game (this is the whole point of the old redirect plugin).
- **Unread indicator**: a dot plus count on a sub-tab that received lines while another view was active; clears when viewed. Tab name turns accent colour. Optional sound later.
- **Peek**: hovering a sub-tab shows the last three lines as a tooltip, so you can glance without switching.
- **Editor**: a "Channels" tab inside the existing Automation panel (next to Triggers / Aliases / Timers) listing tabs, each with name, patterns, mode per pattern, keep-in-main switch, and a Try-it box that shows which tab a pasted line would land in.
- **Timestamps** on captured lines (channel chat is read later, so time matters more than in the RP pane).
- Each channel tab keeps its own scrollback (cap 5,000 lines) and its own scroll-lock.

## Ordering and interaction with triggers

1. Triggers run first (highlight, gag, send). A gagged line never reaches channel tabs.
2. Then channel patterns: first matching pattern across tabs in tab order wins; `silence` drops the line; `capture` routes it.
3. Logs still record everything in order, with a `[tab name]` prefix on captured lines so the daily log reads as a whole.

## Import from MUSHclient

Nothing automatic; the old setup was a plugin + trigger pair that cannot be recovered reliably. Ship the starter patterns above as a one-click "Add Haven channel tabs" preset instead.

## Out of scope for the first cut

Per-tab input prefix (type in the OOC tab and have `ooc ` prepended) is a nice follow-up: a `commandPrefix` field on `ChannelTab`, applied when that sub-tab is active. (Built the same day; see "Command prefix" under "As built".)

## As built (2026-10-20)

Everything above is in, with these details decided during the build:

- **Where it lives.** `shared/types.ts` carries `ChannelTab` / `ChannelPattern` on `World.channelTabs` with `normalizeChannelTab` / `normalizeChannelPattern`, so a `worlds.json` written before this feature loads with an empty list and odd `notify` / `mode` values fall back to `badge` / `capture`. `src/lib/channels.ts` is the pure routing module (`routeLine`, `classifyLine`, `logPrefix`, the Haven preset); `src/lib/store.ts` calls `classifyLine` from `commitPartial`; `src/components/ChannelStrip.tsx` is the sub-tab strip; the Channels editor is a tab in `src/components/AutomationPanel.tsx`. Unit test: `node scripts/test-channels.mjs`.
- **Channel patterns run even while automation is paused** (the ⚡ switch in the status bar pauses triggers and timers only). Paused triggers cannot gag, so with automation off every line reaches the patterns.
- **Logging moved into the renderer.** The main process used to log raw telnet text; it now writes whatever the store sends it, one finished line at a time (`session:log` IPC), which is the only place a line's tab is known. The log records every game line in order, gagged and silenced ones included; captured lines are prefixed `[tab name] `; typed and automated commands log as `> command`. Prompts now log on their own line rather than joined with the command that answered them. Notes (trigger notes, Lua `Note`) are still not logged.
- **Notify.** `badge` and `silent` work as specified. `badge+sound` is also in: a short 880 Hz blip through Web Audio, at most one every two seconds, on top of the badge.
- **Unread on Main too.** While a channel tab is showing, game lines that land in Main count on the `Main` sub-tab the same way, so nothing arrives unseen. Counts clear when a view is shown; switching session tabs clears the count of whichever view that session is on.
- **Panes stay mounted.** Each view (Main and every enabled tab) is its own `OutputPane`, hidden with `display: none` when not active, so scroll position, scroll-lock and the "N new lines" jump button are per pane. Channel panes show `HH:MM` before each line; Main does not.
- **Disabled or deleted tabs.** The strip shows enabled tabs only. Disabling a tab hides its pane but keeps its lines (re-enable and they are back); deleting a tab drops them. If the view you are on disappears, the session falls back to Main.
- **Strip visibility.** The strip is only rendered when the world has at least one enabled channel tab, so worlds without tabs look exactly as before. Its ⚙ opens the Automation panel on the Channels tab.
- **Editor.** Tabs are listed in routing order with ↑ / ↓ to reorder, an enabled checkbox, Duplicate and Delete; each tab has a name, the notify choice, the keep-in-main switch and a pattern list (regex, ignore case, capture / silence). Invalid regexes are outlined and never match. The Try-it box runs the real `classifyLine`, so it also shows when a trigger would gag a pasted line before any tab sees it. "Add Haven channel tabs" appears in the empty state and under the editor; it is disabled once a tab carries all five starter patterns.
- **Smoke test.** The smoke world has an `OOC` tab (keep-in-main, with the Haven patterns plus one that copies the login banner so a login screen lights the badge). `LANTERN_SMOKE_VIEW=OOC` screenshots that tab instead of Main; `LANTERN_SMOKE_PANEL=channels` opens the Channels editor.
- **Unchanged from the spec:** 5,000-line cap per tab, the 10,000-line main cap, first match wins across tabs in order, a gagged line never reaches a tab, input always goes to the game whichever view is showing.

### Command prefix (2026-10-20, second cut)

- **Field.** `ChannelTab.commandPrefix: string`, default `''`; `normalizeChannelTab` fills it in (and replaces a non-string with `''`), so every existing `worlds.json` loads. The Haven preset leaves it empty: the old `Haven-OOC.xml` was a Redirect_Input plugin that forwarded whole commands to another world, so there was no `ooc ` to copy and the right channel command is Noctua's to set in the editor.
- **Where it applies.** `App.sendCommand` only, so only typed commands get it: `activePrefix(tabs, view)` picks the showing tab's prefix (`''` on Main, on a tab without one, or on a disabled or missing tab) and `applyCommandPrefix(prefix, typed)` puts it in front of the text. Both are pure functions in `src/lib/channels.ts`, tested in `scripts/test-channels.mjs`. The prefixed text then goes through `store.execute` as one command, so aliases, command stacking and speedwalk all see `ooc hello` rather than `hello`. A script's `Execute`, triggers and timers call `store.execute` directly and are never prefixed; masked input (a password) is never prefixed either.
- **Bypass.** A command starting with `\` is sent without the prefix, once, and the backslash is removed (`\look` on the OOC tab sends `look`). With no prefix in play the text passes through untouched, backslash included, so Main behaves exactly as before. A blank entry is sent blank rather than as `ooc ` on its own.
- **Echo, log and history.** The output pane and the daily log show what was sent (`› ooc hello`); ↑ recalls what was typed (`hello`), so recalling a command on the same tab does not prefix it twice. `store.input` takes the typed text as a fourth argument for this.
- **UI.** When a prefix applies, the input bar shows it as a chip beside the box (dimmed and struck through while the entry starts with `\`) and names it in the placeholder. A sub-tab with a prefix says so in its tooltip. The Channels editor has a "Command prefix" field with the rules in its hint, and the tab list shows `prefix "ooc "`. The prefix is used verbatim: `ooc` without a trailing space sends `oochi`.
- **Smoke.** The smoke world's `OOC` tab carries `ooc `, so `LANTERN_SMOKE_VIEW=OOC` screenshots the chip.

- **Blank padding (2026-10-20).** Haven prints an empty line before and after each channel message. With a tab's "Trim blank lines around captured lines" (on by default), moving a line into the tab also removes the blank line just before it from Main and swallows the blank that follows, within a 3-second window. The log still records every line.
- **Scrolling fix (2026-10-20).** A pane only snaps to the bottom when it gains lines itself; wheel-up unpins immediately. Before this, Main traffic re-rendering a channel pane kept pulling it back to the bottom.
