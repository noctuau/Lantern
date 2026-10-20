/**
 * The sub-tab strip under the session tabs: Main plus one sub-tab per enabled
 * channel tab. Clicking swaps the output pane (the input bar stays put and
 * always talks to the game). A tab that received lines while another view was
 * showing gets a dot and a count; hovering a tab peeks at its last three lines.
 */
import { useEffect, useRef, useState } from 'react';
import { store, MAIN_VIEW, type SessionState, type Line } from '../lib/store';
import { LineView } from './OutputPane';

const PEEK_DELAY_MS = 350;
const PEEK_LINES = 3;

interface Props {
  session: SessionState;
  /** Open the Channels editor for this world. */
  onEdit(): void;
}

export function ChannelStrip({ session, onEdit }: Props) {
  const enabledTabs = session.world.channelTabs.filter((t) => t.enabled);
  const off = session.channelsOff;
  const tabs = off ? [] : enabledTabs;
  const [peek, setPeek] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const enter = (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(id), PEEK_DELAY_MS);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPeek(null);
  };

  // Nothing to show only when there are no channel tabs at all.
  if (!enabledTabs.length) return null;

  const items: { id: string; name: string; unread: number; lines: Line[]; prefix: string }[] = [
    { id: MAIN_VIEW, name: 'Main', unread: session.mainUnread, lines: session.lines, prefix: '' },
    ...tabs.map((t) => ({ id: t.id, name: t.name || 'Channel', unread: session.channels[t.id]?.unread ?? 0, lines: session.channels[t.id]?.lines ?? [], prefix: t.commandPrefix })),
  ];

  return (
    <div className="subtabs" role="tablist" onMouseLeave={leave}>
      {items.map((it) => {
        const active = session.view === it.id;
        const showUnread = it.unread > 0 && !active;
        return (
          <div
            key={it.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            className={`subtab ${active ? 'active' : ''} ${showUnread ? 'unread' : ''}`}
            title={it.prefix ? `Commands typed here are sent as "${it.prefix}…"` : undefined}
            onClick={() => { leave(); store.setView(session.id, it.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); store.setView(session.id, it.id); } }}
            onMouseEnter={() => { if (!active) enter(it.id); }}
          >
            {showUnread && <span className="udot" />}
            <span className="subtab-name">{it.name}</span>
            {showUnread && <span className="ucount">{it.unread > 999 ? '999+' : it.unread}</span>}
            {peek === it.id && !active && <Peek name={it.name} lines={it.lines} timestamps={it.id !== MAIN_VIEW} />}
          </div>
        );
      })}
      <span className="spacer" />
      <button
        className={`subtab-toggle ${off ? 'off' : ''}`}
        title={off
          ? `Channel tabs are hidden and everything is going to Main. Click to show your ${enabledTabs.length} channel tab${enabledTabs.length === 1 ? '' : 's'} again.`
          : 'Hide all channel tabs and send everything to Main (for when you are not in RP). Your tabs and patterns are kept.'}
        onClick={() => store.setChannelsOff(session.id, !off)}
      >
        {off ? `Show channels (${enabledTabs.length})` : 'Hide channels'}
      </button>
      <button className="icon-btn small" title="Edit channel tabs" onClick={onEdit}>⚙</button>
    </div>
  );
}

function Peek({ name, lines, timestamps }: { name: string; lines: Line[]; timestamps: boolean }) {
  const last = lines.slice(-PEEK_LINES);
  return (
    <div className="peek" onClick={(e) => e.stopPropagation()}>
      <div className="peek-title">{name} · last {last.length === 1 ? 'line' : `${last.length || PEEK_LINES} lines`}</div>
      {last.length === 0
        ? <div className="muted">Nothing captured yet.</div>
        : last.map((l) => <LineView key={l.id} line={l} showTime={timestamps} />)}
    </div>
  );
}
