import { useState } from 'react';
import type { World } from '../lib/store';

interface Props {
  world: World;
  onSave(w: World): void;
  onDelete(w: World): void;
  onClose(): void;
}

export function WorldEditor({ world, onSave, onDelete, onClose }: Props) {
  const [w, setW] = useState<World>({ ...world });
  const set = <K extends keyof World>(k: K, v: World[K]) => setW((x) => ({ ...x, [k]: v }));
  const valid = w.name.trim() && w.host.trim() && w.port > 0 && w.port < 65536;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(w); }}>
        <h2>World settings</h2>
        <label>Name<input autoFocus value={w.name} onChange={(e) => set('name', e.target.value)} /></label>
        <div className="row">
          <label className="grow">Host<input value={w.host} onChange={(e) => set('host', e.target.value)} placeholder="mud.example.org" /></label>
          <label>Port<input type="number" value={w.port} onChange={(e) => set('port', Number(e.target.value))} min={1} max={65535} /></label>
        </div>
        <div className="row">
          <label className="grow">Text encoding
            <select value={w.encoding} onChange={(e) => set('encoding', e.target.value)}>
              <option value="utf-8">UTF-8 (most modern games)</option>
              <option value="latin1">Latin-1 (older MUSHes)</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={w.logging} onChange={(e) => set('logging', e.target.checked)} /> Log sessions</label>
        </div>
        <label>Send on connect
          <textarea rows={2} value={w.autoConnect ?? ''} onChange={(e) => set('autoConnect', e.target.value)} placeholder={'connect Name password\n(one line per command — stored as plain text)'} />
        </label>
        <label>Notes<textarea rows={3} value={w.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></label>
        <div className="modal-actions">
          <button type="button" className="btn danger ghost" onClick={() => onDelete(w)}>Delete</button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid}>Save</button>
        </div>
      </form>
    </div>
  );
}
