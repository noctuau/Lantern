/**
 * Settings › About: what is running, links to the project, and the update check. The check
 * asks main for the latest GitHub release; Download fetches the installer (or portable exe)
 * into the temp folder with a progress bar; Install runs the installer and quits, or shows the
 * portable exe to swap in by hand. The startup check (App) feeds `update` in so a pending
 * update shows the moment the tab opens.
 */
import { useEffect, useState } from 'react';
import { formatSize, ISSUES_URL, RELEASES_URL, REPO_URL, type UpdateInfo } from '../../shared/updates';

interface Props {
  checkOnStart: boolean;
  onCheckOnStart(v: boolean): void;
  /** The last check's result (from the startup check or an earlier look at this tab). */
  update: UpdateInfo | null;
  onUpdate(u: UpdateInfo | null): void;
}

type Phase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing';

interface About { version: string; electron: string; chrome: string; node: string; packaged: boolean; flavour: 'installer' | 'portable' }

/** The message of an IPC error without Electron's "Error invoking remote method" wrapper. */
const errorText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

export function AboutTab({ checkOnStart, onCheckOnStart, update, onUpdate }: Props) {
  const [about, setAbout] = useState<About | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => { window.lantern.app.about().then(setAbout); }, []);
  useEffect(() => window.lantern.update.onProgress((p) => setProgress(p)), []);

  const check = async () => {
    setError(null); setPhase('checking'); setFile(null); setShown(false);
    try {
      const u = await window.lantern.update.check(false);
      onUpdate(u);
      setCheckedAt(new Date());
    } catch (e) { setError(errorText(e)); }
    setPhase('idle');
  };
  const download = async () => {
    if (!update?.asset) return;
    setError(null); setPhase('downloading'); setProgress({ received: 0, total: update.asset.size });
    try {
      setFile(await window.lantern.update.download(update.asset));
      setPhase('downloaded');
    } catch (e) { setError(errorText(e)); setPhase('idle'); }
  };
  const install = async () => {
    if (!file || !update) return;
    setError(null); setPhase('installing');
    try {
      const r = await window.lantern.update.install(file, update.flavour);
      if (r === 'shown') { setShown(true); setPhase('downloaded'); }
    } catch (e) { setError(errorText(e)); setPhase('downloaded'); }
  };
  const open = (url: string) => window.lantern.app.openExternal(url);

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString(); };

  return (
    <>
      <div className="about-head">
        <div className="about-mark">🏮</div>
        <div>
          <div className="about-title">Lantern {about ? `v${about.version}` : ''}</div>
          <div className="hint">A modern MUD/MUSH client, a fresh take on MUSHclient. By Noctua, MIT licence.</div>
          {about && (
            <div className="hint">
              Electron {about.electron} · Chromium {about.chrome} · Node {about.node}
              {about.packaged ? (about.flavour === 'portable' ? ' · portable build' : ' · installed') : ' · running from source'}
            </div>
          )}
        </div>
      </div>
      <div className="about-links">
        <button type="button" onClick={() => open(REPO_URL)}>Project on GitHub</button>
        <button type="button" onClick={() => open(RELEASES_URL)}>All releases</button>
        <button type="button" onClick={() => open(ISSUES_URL)}>Report a problem</button>
      </div>

      <h3>Updates</h3>
      <div className="row">
        <button type="button" className="btn" disabled={phase !== 'idle'} onClick={check}>
          {phase === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {phase === 'idle' && !error && update && !update.newer && (
          <span className="hint">You have the latest version{checkedAt ? ` (checked ${checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}.</span>
        )}
      </div>
      {error && <div className="about-error">{error}</div>}

      {update?.newer && (
        <div className="update-box">
          <div>
            <strong>Lantern v{update.latest} is available</strong>
            <span className="hint"> · you have v{update.current}{update.publishedAt ? ` · released ${when(update.publishedAt)}` : ''}</span>
          </div>
          {update.notes.trim() && <pre className="about-notes">{update.notes.trim().slice(0, 3000)}</pre>}
          {phase === 'downloading' && (
            <>
              <div className="progress"><div style={{ width: `${pct}%` }} /></div>
              <div className="hint">Downloading {update.asset?.name}… {pct}%{progress?.total ? ` of ${formatSize(progress.total)}` : ''}</div>
            </>
          )}
          <div className="row">
            {!file && update.asset && phase !== 'downloading' && (
              <button type="button" className="btn primary" onClick={download}>
                Download {update.flavour === 'portable' ? 'portable exe' : 'installer'}{update.asset.size ? ` (${formatSize(update.asset.size)})` : ''}
              </button>
            )}
            {file && update.flavour === 'installer' && (
              <button type="button" className="btn primary" disabled={phase === 'installing'} onClick={install}>
                {phase === 'installing' ? 'Starting the installer…' : 'Install and restart'}
              </button>
            )}
            {file && update.flavour === 'portable' && (
              <button type="button" className="btn primary" onClick={install}>Show the new exe</button>
            )}
            <button type="button" className="btn ghost" onClick={() => open(update.url)}>Release page</button>
          </div>
          {file && update.flavour === 'installer' && !error && (
            <div className="hint">Lantern will close and the installer will open; it replaces the installed copy and keeps your worlds, settings and logs (they live in %APPDATA%\Lantern). Windows may show a SmartScreen warning because the build is not code-signed: choose More info, then Run anyway.</div>
          )}
          {file && update.flavour === 'portable' && (
            <div className="hint">{shown ? 'The new exe is in the folder that just opened. ' : ''}A portable build cannot replace itself: close Lantern, move the new exe where this one lives, and start it. Your worlds, settings and logs are untouched.</div>
          )}
          {!update.asset && <div className="hint">This release has no {update.flavour === 'portable' ? 'portable exe' : 'installer'} attached; get it from the release page.</div>}
          {about && !about.packaged && <div className="hint">You are running from source, so the downloaded installer would install a separate copy; pull and build instead.</div>}
        </div>
      )}

      <label className="check inline" title="Asks GitHub once, a few seconds after Lantern starts, and marks the Settings button when a newer release exists. Nothing is downloaded until you choose to.">
        <input type="checkbox" checked={checkOnStart} onChange={(e) => onCheckOnStart(e.target.checked)} /> Check for updates when Lantern starts
      </label>
    </>
  );
}
