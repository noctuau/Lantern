import type { World } from '../lib/store';

export type SidebarMode = 'full' | 'rail' | 'hidden';

interface Props {
  worlds: World[];
  mode: SidebarMode;
  onToggle(): void;      // cycles full -> rail -> hidden -> full
  onConnect(w: World): void;
  onEdit(w: World): void;
  onAutomation(w: World): void;
  onNew(): void;
  onImport(): void;
  onSettings(): void;
}

/** Two-letter badge for a world in the icon rail. */
function initials(name: string) {
  const parts = name.trim().split(/[\s\-_]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
}

export function Sidebar({ worlds, mode, onToggle, onConnect, onEdit, onAutomation, onNew, onImport, onSettings }: Props) {
  if (mode === 'hidden') return null;
  const sorted = [...worlds].sort((a, b) => a.name.localeCompare(b.name));
  const next = mode === 'full' ? 'icon rail' : 'hidden';

  if (mode === 'rail') {
    return (
      <aside className="sidebar rail">
        <div className="rail-head">
          <button className="icon-btn" title="Expand the sidebar" onClick={onToggle}>🏮</button>
        </div>
        <div className="rail-list">
          {sorted.map((w) => (
            <button key={w.id} className="rail-world" title={`${w.name} — ${w.host}:${w.port}\nClick to connect`} onClick={() => onConnect(w)}>
              {initials(w.name)}
            </button>
          ))}
        </div>
        <div className="rail-foot">
          <button className="icon-btn" title="New world" onClick={onNew}>＋</button>
          <button className="icon-btn" title="Import MUSHclient worlds (.MCL)" onClick={onImport}>⬇</button>
          <button className="icon-btn" title="Open logs folder" onClick={() => window.lantern.app.openLogs()}>🗂</button>
          <button className="icon-btn" title="Settings" onClick={onSettings}>⚙</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">🏮 Lantern</span>
        <button className="icon-btn" title={`Collapse to ${next}`} onClick={onToggle}>‹</button>
      </div>
      <div className="world-list">
        {sorted.length === 0 && <div className="muted small pad">No worlds yet.</div>}
        {sorted.map((w) => (
          <div key={w.id} className="world" onDoubleClick={() => onConnect(w)}>
            <div className="world-main">
              <div className="world-name">{w.name}</div>
              <div className="world-host muted">{w.host}:{w.port}</div>
            </div>
            <div className="world-actions">
              <button className="btn small" onClick={() => onConnect(w)}>Connect</button>
              <button className="icon-btn" title="Triggers, aliases, timers" onClick={() => onAutomation(w)}>⚡</button>
              <button className="icon-btn" title="Edit" onClick={() => onEdit(w)}>✎</button>
            </div>
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <button className="btn" onClick={onNew}>+ New world</button>
        <button className="btn ghost" onClick={onImport}>Import .MCL</button>
        <button className="btn ghost" onClick={() => window.lantern.app.openLogs()}>Open logs folder</button>
        <button className="btn ghost" onClick={onSettings}>⚙ Settings</button>
      </div>
    </aside>
  );
}
