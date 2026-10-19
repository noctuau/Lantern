import { useCallback, useEffect, useRef, useState } from 'react';
import { store, useStore, type World } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { OutputPane } from './components/OutputPane';
import { InputBar } from './components/InputBar';
import { WorldEditor } from './components/WorldEditor';
import { StatusBar } from './components/StatusBar';

export function App() {
  const s = useStore();
  const [worlds, setWorlds] = useState<World[]>([]);
  const [editing, setEditing] = useState<World | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const refreshWorlds = useCallback(async () => setWorlds(await window.lantern.worlds.list()), []);
  useEffect(() => { refreshWorlds(); }, [refreshWorlds]);

  // Wire main-process events into the store once.
  useEffect(() => {
    const offs = [
      window.lantern.session.onText((id, text) => store.text(id, text)),
      window.lantern.session.onStatus((id, status, msg) => store.setStatus(id, status, msg)),
      window.lantern.session.onPrompt((id) => store.prompt(id)),
      window.lantern.session.onEcho((id, on) => store.setEcho(id, on)),
      window.lantern.session.onGmcp((id, pkg, data) => store.setGmcp(id, pkg, data)),
      window.lantern.session.onInfo((id, msg) => store.note(id, msg)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const connect = async (world: World) => {
    const cols = Math.max(60, Math.floor((window.innerWidth - (sidebarOpen ? 260 : 0) - 48) / 8.4));
    const rows = Math.max(20, Math.floor((window.innerHeight - 140) / 22));
    const id = await window.lantern.session.connect(world.id, { width: cols, height: rows });
    store.add(id, world);
  };

  // Dev smoke test hook (see electron/main.ts).
  useEffect(() => window.lantern.app.onSmoke(async ({ host, port }) => {
    const w = await window.lantern.worlds.create({ name: `Smoke ${host}`, host, port, logging: false });
    await connect(w);
    setTimeout(() => sendCommandRef.current('look'), 3000);
  }), []);
  const sendCommandRef = useRef<(t: string) => void>(() => {});

  const active = s.active();

  const sendCommand = async (text: string) => {
    if (!active) return;
    if (active.status !== 'connected') { store.note(active.id, 'Not connected.', 'error'); return; }
    if (active.echo) store.input(active.id, text);
    await window.lantern.session.send(active.id, text);
  };

  sendCommandRef.current = sendCommand;

  const closeSession = async (id: string) => {
    const sess = store.get(id);
    if (sess && sess.status === 'connected') await window.lantern.session.disconnect(id);
    store.remove(id);
  };

  const saveWorld = async (w: World) => {
    const next = worlds.some((x) => x.id === w.id) ? worlds.map((x) => (x.id === w.id ? w : x)) : [...worlds, w];
    setWorlds(await window.lantern.worlds.save(next));
    setEditing(null);
  };

  const deleteWorld = async (w: World) => {
    if (!confirm(`Delete "${w.name}"? This can't be undone.`)) return;
    setWorlds(await window.lantern.worlds.save(worlds.filter((x) => x.id !== w.id)));
    setEditing(null);
  };

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <Sidebar
        worlds={worlds}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        onConnect={connect}
        onEdit={setEditing}
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
            <StatusBar session={active} />
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
          onSave={saveWorld}
          onDelete={deleteWorld}
          onClose={() => { setEditing(null); refreshWorlds(); }}
        />
      )}
    </div>
  );
}
