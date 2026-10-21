import { useCallback, useEffect, useRef, useState } from 'react';
import { store, useStore, MAIN_VIEW, type World } from './lib/store';
import { activePrefix, applyCommandPrefix, havenChannelTab, helpChannelTab } from './lib/channels';
import { cleanTyped, applyMarkup } from './lib/automation';
import { Sidebar, type SidebarMode } from './components/Sidebar';
import { OutputPane } from './components/OutputPane';
import { ChannelStrip, UnreadPills } from './components/ChannelStrip';
import { InputBar } from './components/InputBar';
import { WorldEditor } from './components/WorldEditor';
import { ColourComposer } from './components/ColourComposer';
import { AutomationPanel, type PanelTab } from './components/AutomationPanel';
import { StatusBar } from './components/StatusBar';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { HighlightDialog } from './components/HighlightDialog';
import { applySettings, normalizeSettings, listSystemFonts, FALLBACK_FONTS, type AppSettings } from './lib/settings';
import type { UpdateInfo } from '../shared/updates';
import type { Trigger } from '../shared/types';

const NO_LINES: never[] = [];

export function App() {
  const s = useStore();
  const [worlds, setWorlds] = useState<World[]>([]);
  const [editing, setEditing] = useState<World | null>(null);
  const [automating, setAutomating] = useState<World | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab | undefined>(undefined);
  // Sidebar has three widths: full, a narrow icon rail, and hidden. Remembered per viewer.
  const [sidebar, setSidebar] = useState<SidebarMode>(() => {
    try { const v = localStorage.getItem('lantern.sidebar'); if (v === 'rail' || v === 'hidden' || v === 'full') return v; } catch { /* ignore */ }
    return 'full';
  });
  useEffect(() => { try { localStorage.setItem('lantern.sidebar', sidebar); } catch { /* ignore */ } }, [sidebar]);
  const cycleSidebar = () => setSidebar((s) => (s === 'full' ? 'rail' : s === 'rail' ? 'hidden' : 'full'));
  const sidebarWidth = sidebar === 'full' ? 260 : sidebar === 'rail' ? 56 : 0;
  const [settings, setSettings] = useState<AppSettings>(() => normalizeSettings(null));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS);
  const [highlight, setHighlight] = useState<{ worldId: string; text: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const insertRef = useRef<(t: string) => void>(() => {});
  const registerInsert = useCallback((fn: (t: string) => void) => { insertRef.current = fn; }, []);
  const inputSelRef = useRef<() => string>(() => '');
  const registerGetSelection = useCallback((fn: () => string) => { inputSelRef.current = fn; }, []);

  // The current selection to colour: the command box wins (it survives blur), else the output pane.
  const grabSelection = useCallback(() => {
    const inSel = inputSelRef.current?.() ?? '';
    if (inSel.trim()) return inSel;
    return window.getSelection()?.toString() ?? '';
  }, []);
  const worldsRef = useRef<World[]>([]);
  worldsRef.current = worlds;

  const refreshWorlds = useCallback(async () => setWorlds(await window.lantern.worlds.list()), []);
  useEffect(() => { refreshWorlds(); }, [refreshWorlds]);

  // Give the store the custom colours so triggers that reference one ("custom:<id>") resolve live.
  const pushCustomColours = (s: AppSettings) => {
    store.customColours = Object.fromEntries(s.customColours.map((c) => [c.id, { fg: c.fg, bg: c.bg }]));
  };

  // The last update check (Settings › About); the startup check fills it in a few seconds after launch.
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  // Which Settings tab to open on; null = Text, or About while an update is waiting.
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);

  // The font list arrives behind the Settings dialog, never in front of it: the dialog opens at once with
  // whatever list is known (prefetched a few seconds after launch, else the fallback) and fills in when
  // Windows answers.
  const loadFonts = useCallback(() => { listSystemFonts().then((f) => { if (f !== FALLBACK_FONTS) setFonts(f); }).catch(() => {}); }, []);

  // Display settings: load once, apply as CSS variables, persist on change.
  useEffect(() => {
    window.lantern.settings.get().then((raw) => {
      const s = normalizeSettings(raw as Partial<AppSettings> | null); setSettings(s); applySettings(s); pushCustomColours(s);
      // Quiet startup check (installed builds only; main skips it from source or in smoke runs). A failure is silent here:
      // the About tab's own button reports errors.
      if (s.checkUpdates) setTimeout(() => { window.lantern.update.check(true).then((u) => { if (u) setUpdate(u); }).catch(() => {}); }, 8000);
      // Warm the font list so Settings has it ready (main caches it on disk too).
      setTimeout(loadFonts, 3000);
    });
  }, [loadFonts]);
  const saveSettings = useCallback(async (s: AppSettings) => {
    setSettings(s); applySettings(s); pushCustomColours(s);
    // Tell live sessions the new width (NAWS), so server-wrapped games follow it too.
    const paneCols = Math.max(60, Math.floor((window.innerWidth - sidebarWidth - 48) / 8.4));
    const rows = Math.max(20, Math.floor((window.innerHeight - 140) / 22));
    for (const id of store.order) window.lantern.session.resize(id, s.outputWidth || paneCols, rows);
    await window.lantern.settings.set(s as unknown as Record<string, unknown>);
  }, [sidebarWidth]);
  const openSettings = () => {
    setSettingsOpen(true);
    if (fonts === FALLBACK_FONTS) loadFonts();
  };

  // Ctrl+Alt+H: quick highlight for the active world, seeded with any selected output text.
  const openHighlight = useCallback(() => {
    const sess = store.active(); if (!sess) return;
    const text = (window.getSelection()?.toString() ?? '').trim().split('\n')[0] ?? '';
    setHighlight({ worldId: sess.world.id, text });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); openHighlight(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openHighlight]);

  // Right-click a selection in the output or command box to offer the colour composer.
  const openComposer = useCallback((seed: string) => { setComposerSeed(seed.trim()); setComposerOpen(true); }, []);
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t.closest('.output') || t.closest('.input'))) return;
      const text = grabSelection().trim();
      if (!text) return;
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, text });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, [grabSelection]);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', onKey); };
  }, [ctxMenu]);
  const addHighlight = async (t: Trigger) => {
    if (!highlight) return;
    const w = worldsRef.current.find((x) => x.id === highlight.worldId) ?? store.active()?.world;
    if (w) await saveWorld({ ...w, triggers: [...w.triggers, t] });
    setHighlight(null);
  };

  /** Persist one world and push it to any open session on it (which may hand back script variables it owns). */
  const saveWorld = useCallback(async (w0: World) => {
    // First save of a Haven world: pre-load its channel tabs (OOC/Guide/Newbie/tells + Help),
    // all disabled, so new players can just tick on what they want instead of configuring it.
    let w = w0;
    if (!w.seededDefaults && /(^|\.)havenrpg\.net$/i.test(w.host.trim()) && (w.channelTabs?.length ?? 0) === 0) {
      const nid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      w = { ...w, seededDefaults: true, channelTabs: [
        { ...havenChannelTab(nid), enabled: false },
        { ...helpChannelTab(nid), enabled: false },
      ] };
    }
    // Apply to the live session, but never let that step block the disk write: a failure here
    // once meant edits (imported triggers, channel tabs, log settings) were live but never saved.
    let applied = w;
    try { applied = store.updateWorld(w); }
    catch (e) { console.error('Applying the world to the live session failed; saving to disk anyway', e); }
    const cur = worldsRef.current;
    const next = cur.some((x) => x.id === applied.id) ? cur.map((x) => (x.id === applied.id ? applied : x)) : [...cur, applied];
    worldsRef.current = next;
    setWorlds(next);
    setWorlds(await window.lantern.worlds.save(next));
  }, []);

  // Wire main-process events into the store once, and give the store its way back out.
  useEffect(() => {
    store.hooks = {
      send: (id, text) => { window.lantern.session.send(id, text); },
      worldChanged: (w) => { saveWorld(w); },
      loadScript: (worldId) => window.lantern.scripts.read(worldId),
      log: (id, text, kind, html) => { window.lantern.session.log(id, text, kind, html); },
    };
    const offs = [
      window.lantern.session.onText((id, text) => store.text(id, text)),
      window.lantern.session.onStatus((id, status, msg) => store.setStatus(id, status, msg)),
      window.lantern.session.onPrompt((id) => store.prompt(id)),
      window.lantern.session.onEcho((id, on) => store.setEcho(id, on)),
      window.lantern.session.onGmcp((id, pkg, data) => store.setGmcp(id, pkg, data)),
      window.lantern.session.onInfo((id, msg) => store.note(id, msg)),
    ];
    return () => offs.forEach((off) => off());
  }, [saveWorld]);

  // The width told to the server (NAWS): a fixed Output width if set, else the pane's own columns.
  const termSize = () => {
    const paneCols = Math.max(60, Math.floor((window.innerWidth - sidebarWidth - 48) / 8.4));
    const rows = Math.max(20, Math.floor((window.innerHeight - 140) / 22));
    return { width: settings.outputWidth || paneCols, height: rows };
  };

  const connect = async (world: World) => {
    const id = await window.lantern.session.connect(world.id, termSize());
    store.add(id, world);
  };

  // Dev smoke test hook (see electron/main.ts). The throwaway world carries a demo trigger, alias,
  // Lua script and channel tab so the screenshot shows automation, scripting and capture end to end.
  useEffect(() => window.lantern.app.onSmoke(async ({ host, port, panel, view, auto }) => {
    const w = await window.lantern.worlds.create({
      name: `Smoke ${host}`, host, port, autoConnect: auto,
      // LANTERN_SMOKE_PANEL=world also logs the run in HTML (into the throwaway profile) and opens the world editor.
      logging: panel === 'world',
      log: { output: true, commands: true, notes: true, format: 'html', file: '{world}/%Y-%m-%d %H%M', worldNameHeader: true },
      triggers: [
        { id: 'smoke-hl', name: 'Highlight game name', pattern: 'aardwolf', regex: true, enabled: true, group: 'demo', ignoreCase: true, send: '', sendTo: 'world', highlight: '11', highlightBg: null, highlightLine: false, gag: false, oneShot: false },
        { id: 'smoke-note', name: 'Name prompt', pattern: 'thy name', regex: true, enabled: true, group: 'demo', ignoreCase: true, send: 'Trigger fired on "%0"', sendTo: 'output', highlight: null, highlightBg: null, highlightLine: false, gag: false, oneShot: true, script: 'on_name_prompt' },
      ],
      aliases: [
        { id: 'smoke-alias', name: 'look shortcut', pattern: 'l', regex: false, enabled: true, group: '', ignoreCase: true, send: 'look %1', sendTo: 'world' },
      ],
      // The Haven starter patterns plus one that copies the login banner, so a login screen lights the badge.
      // The "ooc " prefix shows in the input bar when LANTERN_SMOKE_VIEW=OOC.
      channelTabs: [{
        id: 'smoke-help', name: 'Help', enabled: true, keepInMain: false, trimBlanks: false, timestamps: true, notify: 'badge', commandPrefix: '',
        captureCommands: '^(help|look)\\b', captureQuietMs: 1500, messageGap: 0, patterns: [],
      }, {
        id: 'smoke-ooc', name: 'OOC', enabled: true, keepInMain: true, trimBlanks: true, timestamps: true, notify: 'badge', commandPrefix: 'ooc ',
        captureCommands: '', captureQuietMs: 1500, messageGap: 6,
        patterns: [
          { id: 'smoke-p1', pattern: '^\\[OOC\\] ', ignoreCase: false, mode: 'capture' },
          { id: 'smoke-p2', pattern: '^\\[AFK\\]\\s*$', ignoreCase: false, mode: 'silence' },
          { id: 'smoke-p3', pattern: 'aardwolf|thy name', ignoreCase: true, mode: 'capture' },
        ],
      }],
    });
    await window.lantern.scripts.write(w.id, [
      '-- smoke-test script',
      'function on_name_prompt(name, line, wildcards)',
      '  SetVariable("last_prompt", wildcards[0])',
      '  ColourNote("#7fd37f", "", "Lua ", "yellow", "", name, "#7fd37f", "", " saw \\"" .. wildcards[0] .. "\\"; last_prompt = " .. GetVariable("last_prompt"))',
      'end',
    ].join('\n'));
    await connect(w);
    if (panel === 'highlight') setHighlight({ worldId: w.id, text: 'Aardwolf' });
    else if (panel === 'world') setTimeout(() => setEditing(w), 4500);
    else if (panel === 'about') { setSettingsTab('about'); setSettingsOpen(true); }
    else if (panel === 'settings') {
      loadFonts(); setSettingsOpen(true);
      // Open the first font dropdown so the screenshot shows the list.
      setTimeout(() => (document.querySelector('.font-btn') as HTMLButtonElement | null)?.click(), 2500);
    }
    else if (panel) { setPanelTab(panel === 'script' ? 'script' : panel === 'channels' ? 'channels' : panel === 'options' ? 'options' : undefined); setAutomating(w); }
    setTimeout(() => sendCommandRef.current('look'), 3000);
    if (view) {
      // LANTERN_SMOKE_VIEW=<tab name> screenshots that channel tab instead of Main.
      setTimeout(() => {
        const sess = store.active();
        const tab = sess?.world.channelTabs.find((t) => t.name.toLowerCase() === view.toLowerCase());
        if (sess && tab) store.setView(sess.id, tab.id);
        // A command typed from the tab: its echo should appear in that tab, with the tab's prefix.
        setTimeout(() => sendCommandRef.current('who'), 600);
      }, 4000);
    }
  }), []);
  const sendCommandRef = useRef<(t: string) => void>(() => {});
  const markupTipShown = useRef(new Set<string>());

  const active = s.active();

  const sendCommand = async (raw: string) => {
    if (!active) return;
    if (active.status !== 'connected') { store.note(active.id, 'Not connected.', 'error'); return; }
    // Masked input (a password) is never cleaned, expanded, prefixed or echoed.
    if (!active.echo) { await window.lantern.session.send(active.id, raw); return; }
    // Typed commands only (a script's Execute calls store.execute directly): first tidy smart
    // punctuation into ASCII (Settings › "Tidy what I type"), then a channel tab's command
    // prefix goes on, then aliases, stacking and speedwalk see the whole thing.
    // The echo and log show what was sent; history keeps what was typed (tidied).
    const typed = settings.cleanInput ? cleanTyped(raw) : raw;
    const { text: prefixed } = applyCommandPrefix(activePrefix(active.world.channelTabs, active.view), typed);
    // *italic* / **bold** / __underline__ → the world's format codes, in listed chat commands only (Options tab).
    const text = applyMarkup(active.world.markup, prefixed);
    // With the option off, say once per world when a chat command carried markup that would have been converted.
    if (!active.world.markup.enabled && !markupTipShown.current.has(active.world.id)
      && applyMarkup({ ...active.world.markup, enabled: true }, prefixed) !== prefixed) {
      markupTipShown.current.add(active.world.id);
      store.note(active.id, 'Sent as typed. To send *word* as italics (and **bold**, __underline__), turn on "Chat markup" under ⚡ Automation › Options for this world.');
    }
    store.input(active.id, text, true, typed, settings.echoInput);
    store.execute(active.id, text, false);
  };

  sendCommandRef.current = sendCommand;

  const closeSession = async (id: string) => {
    const sess = store.get(id);
    if (sess && sess.status === 'connected') await window.lantern.session.disconnect(id);
    store.remove(id);
  };

  const deleteWorld = async (w: World) => {
    if (!confirm(`Delete "${w.name}"? This can't be undone.`)) return;
    setWorlds(await window.lantern.worlds.save(worlds.filter((x) => x.id !== w.id)));
    setEditing(null);
  };

  /** Open the automation panel on the latest saved copy of a world. */
  const openAutomation = (w: World, tab?: PanelTab) => { setPanelTab(tab); setAutomating(worlds.find((x) => x.id === w.id) ?? w); };

  return (
    <div className={`app sidebar-${sidebar}`}>
      <Sidebar
        worlds={worlds}
        mode={sidebar}
        onToggle={cycleSidebar}
        onConnect={connect}
        onEdit={setEditing}
        onAutomation={(w) => openAutomation(w)}
        onNew={async () => setEditing(await window.lantern.worlds.create())}
        onImport={async () => { await window.lantern.worlds.importMcl(); refreshWorlds(); }}
        onSettings={openSettings}
        updateAvailable={update?.newer ? update.latest : null}
      />
      <main className="main">
        <div className="tabs">
          {sidebar === 'hidden' && (
            <button className="icon-btn" title="Show the sidebar" onClick={() => setSidebar('full')}>☰</button>
          )}
          {s.order.map((id) => {
            const sess = s.get(id)!;
            return (
              <div
                key={id}
                className={`tab ${id === s.activeId ? 'active' : ''} status-${sess.status}`}
                onClick={() => store.setActive(id)}
              >
                <span className="dot" />
                <span className="tab-name">{sess.world.name}</span>
                {sess.unread > 0 && id !== s.activeId && <span className="badge">{sess.unread}</span>}
                <button className="tab-close" title="Close" onClick={(e) => { e.stopPropagation(); closeSession(id); }}>×</button>
              </div>
            );
          })}
          {s.order.length === 0 && <div className="tab-hint">Pick a world on the left to connect.</div>}
          <span className="spacer" />
          {active && (
            <>
              <button className="btn small ghost" title="Compose coloured/gradient text to send. Select text first to pre-fill it." onMouseDown={() => setComposerSeed(grabSelection().trim())} onClick={() => setComposerOpen(true)}>
                🎨 Colour
              </button>
              <button className="btn small ghost" title="Highlight a word or phrase (Ctrl+Alt+H). Select text in the output first to pre-fill it." onClick={openHighlight}>
                ✎ Highlight
              </button>
              <button className="btn small ghost" title="Triggers, aliases, timers and channel tabs for this world" onClick={() => openAutomation(active.world)}>
                ⚡ Automation
              </button>
            </>
          )}
          <button className="btn small ghost" title="Settings" onClick={openSettings}>⚙ Settings</button>
        </div>

        {active ? (
          <>
            <ChannelStrip key={`strip-${active.id}`} session={active} onEdit={() => openAutomation(active.world, 'channels')} />
            <OutputPane key={`out-${active.id}`} lines={active.lines} partial={active.partial} autoScroll={settings.autoScroll} visible={active.view === MAIN_VIEW} extras={<UnreadPills session={active} />} />
            {active.world.channelTabs.filter((t) => t.enabled).map((t) => (
              <OutputPane
                key={`out-${active.id}-${t.id}`}
                lines={active.channels[t.id]?.lines ?? NO_LINES}
                timestamps={t.timestamps}
                lineGap={t.messageGap}
                autoScroll={settings.autoScroll}
                visible={active.view === t.id}
                emptyHint={`Nothing captured for ${t.name || 'this tab'} yet. Lines matching its patterns will show here with the time they arrived.`}
                extras={<UnreadPills session={active} />}
              />
            ))}
            <InputBar
              key={`in-${active.id}`}
              session={active}
              minLines={settings.inputLines}
              onResize={(lines) => saveSettings({ ...settings, inputLines: lines })}
              onSend={sendCommand}
              onReconnect={() => connect(active.world)}
              registerInsert={registerInsert}
              registerGetSelection={registerGetSelection}
            />
            <StatusBar session={active} onToggleAutomation={() => store.setAutomation(active.id, !active.automation)} />
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-mark">🏮</div>
            <h1>Lantern</h1>
            <p>A fresh light on old worlds.</p>
            <p className="muted">Add a world, or import your MUSHclient .MCL files from the sidebar.</p>
          </div>
        )}
      </main>

      {editing && (
        <WorldEditor
          world={editing}
          onSave={async (w) => { await saveWorld(w); setEditing(null); }}
          onDelete={deleteWorld}
          onClose={() => { setEditing(null); refreshWorlds(); }}
        />
      )}

      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="ctx-item" onClick={() => { openComposer(ctxMenu.text); setCtxMenu(null); }}>
            🎨 Colour composer
          </button>
        </div>
      )}

      {composerOpen && (
        <ColourComposer initialText={composerSeed} onInsert={(t) => insertRef.current(t)} onClose={() => setComposerOpen(false)} />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          fonts={fonts}
          onSave={async (s) => { await saveSettings(s); setSettingsOpen(false); setSettingsTab(null); }}
          onClose={() => { setSettingsOpen(false); setSettingsTab(null); }}
          initialTab={settingsTab ?? (update?.newer ? 'about' : 'text')}
          update={update}
          onUpdate={setUpdate}
        />
      )}

      {highlight && (
        <HighlightDialog
          worldName={worlds.find((x) => x.id === highlight.worldId)?.name ?? 'this world'}
          initialText={highlight.text}
          onSave={addHighlight}
          onClose={() => setHighlight(null)}
        />
      )}

      {automating && (
        <AutomationPanel
          world={automating}
          initialTab={panelTab}
          customColours={settings.customColours}
          onSave={async (w) => { await saveWorld(w); setAutomating(null); }}
          onReloadScript={() => store.reloadLua(automating.id)}
          onClose={() => { setAutomating(null); setPanelTab(undefined); }}
        />
      )}
    </div>
  );
}
