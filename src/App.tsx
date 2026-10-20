import { useCallback, useEffect, useRef, useState } from 'react';
import { store, useStore, type World } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { OutputPane } from './components/OutputPane';
import { InputBar } from './components/InputBar';
import { WorldEditor } from './components/WorldEditor';
import { AutomationPanel } from './components/AutomationPanel';
import { StatusBar } from './components/StatusBar';

export function App() {
  const s = useStore();
  const [worlds, setWorlds] = useState<World[]>([]);
  const [editing, setEditing] = useState<World | null>(null);
  const [automating, setAutomating] = useState<World | null>(null);
  const [panelTab, setPanelTab] = useState<'script' | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const worldsRef = useRef<World[]>([]);
  worldsRef.current = worlds;

  const refreshWorlds = useCallback(async () => setWorlds(await window.lantern.worlds.list()), []);
  useEffect(() => { refreshWorlds(); }, [refreshWorlds]);

  /** Persist one world and push it to any open session on it (which may hand back script variables it owns). */
  const saveWorld = useCallback(async (w: World) => {
    const applied = store.updateWorld(w);
    const cur = worldsRef.current;
    const next = cur.some((x) => x.id === w.id) ? cur.map((x) => (x.id === w.id ? applied : x)) : [...cur, applied];
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

  const connect = async (world: World) => {
    const cols = Math.max(60, Math.floor((window.innerWidth - (sidebarOpen ? 260 : 0) - 48) / 8.4));
    const rows = Math.max(20, Math.floor((window.innerHeight - 140) / 22));
    const id = await window.lantern.session.connect(world.id, { width: cols, height: rows });
    store.add(id, world);
  };

  // Dev smoke test hook (see electron/main.ts). The throwaway world carries a demo trigger, alias and
  // Lua script so the screenshot shows the automation and scripting paths end to end.
  useEffect(() => window.lantern.app.onSmoke(async ({ host, port, panel }) => {
    const w = await window.lantern.worlds.create({
      name: `Smoke ${host}`, host, port, logging: false,
      triggers: [
        { id: 'smoke-hl', name: 'Highlight game name', pattern: 'aardwolf', regex: true, enabled: true, group: 'demo', ignoreCase: true, send: '', sendTo: 'world', highlight: '11', highlightLine: false, gag: false, oneShot: false },
        { id: 'smoke-note', name: 'Name prompt', pattern: 'thy name', regex: true, enabled: true, group: 'demo', ignoreCase: true, send: 'Trigger fired on "%0"', sendTo: 'output', highlight: null, highlightLine: false, gag: false, oneShot: true, script: 'on_name_prompt' },
      ],
      aliases: [
        { id: 'smoke-alias', name: 'look shortcut', pattern: 'l', regex: false, enabled: true, group: '', ignoreCase: true, send: 'look %1', sendTo: 'world' },
      ],
    });
    await window.lantern.scripts.write(w.id, [
      '-- smoke-test script',
      'function on_name_prompt(name, line, wildcards)',
      '  SetVariable("last_prompt", wildcards[0])',
      '  ColourNote("#7fd37f", "", "Lua ", "yellow", "", name, "#7fd37f", "", " saw \\"" .. wildcards[0] .. "\\"; last_prompt = " .. GetVariable("last_prompt"))',
      'end',
    ].join('\n'));
    await connect(w);
    if (panel) { setPanelTab(panel === 'script' ? 'script' : undefined); setAutomating(w); }
    setTimeout(() => sendCommandRef.current('look'), 3000);
  }), []);
  const sendCommandRef = useRef<(t: string) => void>(() => {});

  const active = s.active();

  const sendCommand = async (text: string) => {
    if (!active) return;
    if (active.status !== 'connected') { store.note(active.id, 'Not connected.', 'error'); return; }
    // Masked input (a password) is never expanded or echoed.
    if (!active.echo) { await window.lantern.session.send(active.id, text); return; }
    store.input(active.id, text);
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
  const openAutomation = (w: World) => setAutomating(worlds.find((x) => x.id === w.id) ?? w);

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <Sidebar
        worlds={worlds}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        onConnect={connect}
        onEdit={setEditing}
        onAutomation={openAutomation}
        onNew={async () => setEditing(await window.lantern.worlds.create())}
        onImport={async () => { await window.lantern.worlds.importMcl(); refreshWorlds(); }}
      />
      <main className="main">
        <div className="tabs">
          {!sidebarOpen && (
            <button className="icon-btn" title="Show worlds" onClick={() => setSidebarOpen(true)}>☰</button>
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
          {active && (
            <>
              <span className="spacer" />
              <button className="btn small ghost" title="Triggers, aliases and timers for this world" onClick={() => openAutomation(active.world)}>
                ⚡ Automation
              </button>
            </>
          )}
        </div>

        {active ? (
          <>
            <OutputPane key={active.id} session={active} />
            <InputBar
              key={`in-${active.id}`}
              session={active}
              onSend={sendCommand}
              onReconnect={() => connect(active.world)}
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

      {automating && (
        <AutomationPanel
          world={automating}
          initialTab={panelTab}
          onSave={async (w) => { await saveWorld(w); setAutomating(null); }}
          onReloadScript={() => store.reloadLua(automating.id)}
          onClose={() => { setAutomating(null); setPanelTab(undefined); }}
        />
      )}
    </div>
  );
}
