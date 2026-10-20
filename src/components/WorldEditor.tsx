import { useEffect, useState } from 'react';
import type { World } from '../lib/store';
import type { LogSettings } from '../../shared/types';
import { expandLogName, DEFAULT_LOG_FILE } from '../../shared/logname';

interface Props {
  world: World;
  onSave(w: World): void;
  onDelete(w: World): void;
  onClose(): void;
}

export function WorldEditor({ world, onSave, onDelete, onClose }: Props) {
  const [w, setW] = useState<World>({ ...world, log: { ...world.log } });
  const [logsDir, setLogsDir] = useState('');
  const set = <K extends keyof World>(k: K, v: World[K]) => setW((x) => ({ ...x, [k]: v }));
  const setLog = <K extends keyof LogSettings>(k: K, v: LogSettings[K]) => setW((x) => ({ ...x, log: { ...x.log, [k]: v } }));
  const valid = w.name.trim() && w.host.trim() && w.port > 0 && w.port < 65536;

  useEffect(() => { window.lantern.app.logsDir().then(setLogsDir); }, []);

  const preview = expandLogName(w.log.file, w.name, w.log.format);
  const previewFull = (/^([a-zA-Z]:[\\/]|\\\\)/.test(preview) ? preview : `${logsDir}\\${preview}`).replace(/\//g, '\\');

  const browse = async () => {
    const dir = await window.lantern.app.chooseFolder('Choose the folder for this world\'s logs');
    if (!dir) return;
    // Keep the file-name part of the current pattern, in the chosen folder.
    const current = w.log.file || DEFAULT_LOG_FILE;
    const base = current.split(/[\\/]/).pop() || DEFAULT_LOG_FILE;
    setLog('file', `${dir}\\${base}`);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal wide" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(w); }}>
        <button type="button" className="modal-x" title="Close" onClick={onClose}>×</button>
        <h2>World settings</h2>

        <h3>Connection</h3>
        <label>Name<input autoFocus value={w.name} onChange={(e) => set('name', e.target.value)} /></label>
        <div className="row">
          <label className="grow">Host<input value={w.host} onChange={(e) => set('host', e.target.value)} placeholder="mud.example.org" /></label>
          <label>Port<input type="number" value={w.port} onChange={(e) => set('port', Number(e.target.value))} min={1} max={65535} /></label>
          <label>Text encoding
            <select value={w.encoding} onChange={(e) => set('encoding', e.target.value)}>
              <option value="utf-8">UTF-8 (most modern games)</option>
              <option value="latin1">Latin-1 (older MUSHes)</option>
            </select>
          </label>
        </div>
        <label>Send on connect
          <textarea rows={2} value={w.autoConnect ?? ''} onChange={(e) => set('autoConnect', e.target.value)} placeholder={'connect Name password\n(one line per command — stored as plain text)'} />
        </label>

        <h3>Logging</h3>
        <label className="check inline"><input type="checkbox" checked={w.logging} onChange={(e) => set('logging', e.target.checked)} /> Log this world</label>
        <div className={`log-options ${w.logging ? '' : 'disabled'}`}>
          <div className="row">
            <fieldset className="group">
              <legend>What to log</legend>
              <label className="check inline"><input type="checkbox" checked={w.log.output} onChange={(e) => setLog('output', e.target.checked)} /> Output</label>
              <label className="check inline"><input type="checkbox" checked={w.log.commands} onChange={(e) => setLog('commands', e.target.checked)} /> Commands</label>
              <label className="check inline"><input type="checkbox" checked={w.log.notes} onChange={(e) => setLog('notes', e.target.checked)} /> Notes</label>
            </fieldset>
            <fieldset className="group">
              <legend>Format</legend>
              <label className="check inline"><input type="radio" name="logfmt" checked={w.log.format === 'text'} onChange={() => setLog('format', 'text')} /> Plain text</label>
              <label className="check inline"><input type="radio" name="logfmt" checked={w.log.format === 'html'} onChange={() => setLog('format', 'html')} /> HTML with colours</label>
              <label className="check inline" title="Diagnostic: the exact bytes the game sends, with colour codes shown as \e[...]. For troubleshooting, not everyday reading."><input type="radio" name="logfmt" checked={w.log.format === 'raw'} onChange={() => setLog('format', 'raw')} /> Raw (colour codes)</label>
            </fieldset>
            <fieldset className="group">
              <legend>Header</legend>
              <label className="check inline"><input type="checkbox" checked={w.log.worldNameHeader} onChange={(e) => setLog('worldNameHeader', e.target.checked)} /> Write world name and date at the start of each session</label>
            </fieldset>
          </div>
          <label>Log file name
            <div className="row">
              <input className="mono grow" value={w.log.file} onChange={(e) => setLog('file', e.target.value)} placeholder={DEFAULT_LOG_FILE} spellCheck={false} />
              <button type="button" className="btn" onClick={browse}>Browse…</button>
            </div>
            <span className="hint">
              {'{world}'} is the world name; %a weekday, %d day, %b month, %Y year, %H %M time (the same fields MUSHclient uses). A bare name goes in Lantern's logs folder; a full path goes where you say. Today this would be:
            </span>
            <span className="hint mono log-preview">{previewFull}</span>
          </label>
        </div>

        <h3>Notes</h3>
        <label><textarea rows={3} value={w.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Anything you want to remember about this world or character" /></label>

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
