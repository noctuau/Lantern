import type { World } from '../lib/store';

interface Props {
  worlds: World[];
  open: boolean;
  onToggle(): void;
  onConnect(w: World): void;
  onEdit(w: World): void;
  onNew(): void;
  onImport(): void;
}

export function Sidebar({ worlds, open, onToggle, onConnect, onEdit, onNew, onImport }: Props) {
  if (!open) return null;
  const sorted = [...worlds].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">🏮 Lantern</span>
        <button className="icon-btn" title="Hide worlds" onClick={onToggle}>‹</button>
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
              <button className="icon-btn" title="Edit" onClick={() => onEdit(w)}>✎</button>
            </div>
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <button className="btn" onClick={onNew}>+ New world</button>
        <button className="btn ghost" onClick={onImport}>Import .MCL</button>
        <button className="btn ghost" onClick={() => window.lantern.app.openLogs()}>Open logs folder</button>
      </div>
    </aside>
  );
}
