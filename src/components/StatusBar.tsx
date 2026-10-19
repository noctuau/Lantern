import { useEffect, useState } from 'react';
import type { SessionState } from '../lib/store';

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

export function StatusBar({ session, onToggleAutomation }: { session: SessionState; onToggleAutomation(): void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const up = session.status === 'connected' && session.connectedAt ? fmt(Date.now() - session.connectedAt) : null;
  return (
    <div className={`status-bar status-${session.status}`}>
      <span className="dot" />
      <span>{session.status === 'connected' ? 'Connected' : session.status === 'connecting' ? 'Connecting…' : session.status === 'error' ? 'Error' : 'Offline'}</span>
      <span className="muted">{session.world.host}:{session.world.port}</span>
      {up && <span className="muted">· {up}</span>}
      <span className="spacer" />
      <button
        className={`status-toggle ${session.automation ? '' : 'off'}`}
        title={session.automation ? 'Triggers and timers are on. Click to pause.' : 'Triggers and timers are paused. Click to resume.'}
        onClick={onToggleAutomation}
      >
        ⚡ {session.automation ? (session.fired ? `${session.fired} fired` : 'automation on') : 'paused'}
      </button>
      {session.world.logging && <span className="muted" title="Logging to the logs folder">● logging</span>}
      <span className="muted">{session.lines.length.toLocaleString()} lines</span>
    </div>
  );
}
