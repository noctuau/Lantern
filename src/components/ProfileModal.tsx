import { useEffect, useMemo, useState } from 'react';
import type { Profile } from '../../shared/profiles';
import { getProfileCapture } from '../lib/profileview';
import { openLightbox } from '../lib/lightbox';
import { renderSpan } from './OutputPane';

/**
 * A My Haven profile: the scraped photo carousel on the left, the game's own About Me text (captured
 * when you pulled the profile up in-game) on the right, in fixed font with the player's colours. The
 * text always shows; the photos appear once you've run a profile refresh. Esc / click-outside / ✕ close.
 */
export function ProfileModal({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined); // undefined = loading
  const [idx, setIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // The in-game text block captured for this handle (lines of coloured spans).
  const lines = useMemo(() => getProfileCapture(handle), [handle]);

  // Drop a leading "@handle(…)" header line — the modal header already shows the handle, so it'd just repeat.
  const textLines = useMemo(() => {
    if (!lines || !lines.length) return lines;
    const esc = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headRe = new RegExp(`^@${esc}(?:\\(|\\b|$)`, 'i');
    const first = lines[0].map((sp) => sp.text).join('').trim();
    return headRe.test(first) ? lines.slice(1) : lines;
  }, [lines, handle]);

  useEffect(() => {
    let live = true;
    window.lantern.profiles.get(handle).then((p) => { if (live) setProfile(p); }).catch(() => { if (live) setProfile(null); });
    return () => { live = false; };
  }, [handle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const photos = profile?.photos ?? [];
  const at = photos.length ? ((idx % photos.length) + photos.length) % photos.length : 0;
  const name = profile?.name || `@${handle}`;

  // Re-fetch just this one profile's latest photos/name from My Haven (the About Me text comes from the
  // in-game capture, so it isn't touched here). Only possible once we know the profile's page URL.
  const onRefresh = async () => {
    if (refreshing || !profile?.url) return;
    setRefreshing(true);
    try {
      const fresh = await window.lantern.profiles.refreshOne(handle, profile.url);
      if (fresh) { setProfile(fresh); setIdx(0); }
    } catch { /* leave the current photos in place */ }
    finally { setRefreshing(false); }
  };

  return (
    <div className="modal-backdrop profile-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="profile-view">
        <div className="profile-head">
          <div className="profile-id">
            <span className="profile-name">{name}</span>
            <span className="profile-handle">@{handle}</span>
          </div>
          <div className="profile-actions">
            {profile?.url && (
              <button type="button" className="btn small ghost" title="Open the web profile in your browser"
                onClick={() => window.lantern.app.openExternal(profile.url)}>Open in browser</button>
            )}
            <button type="button" className="icon-btn" title="Close (Esc)" onClick={onClose} autoFocus>✕</button>
          </div>
        </div>

        <div className="profile-body">
          <div className="profile-photos">
            {photos.length > 0 ? (
              <>
                <img
                  className="profile-photo"
                  src={photos[at]}
                  alt={`${name} — photo ${at + 1}`}
                  title="Click to view full size"
                  onClick={() => openLightbox(photos[at])}
                />
                {photos.length > 1 && (
                  <>
                    <button type="button" className="profile-nav prev" title="Previous photo" onClick={() => setIdx(at - 1)}>‹</button>
                    <button type="button" className="profile-nav next" title="Next photo" onClick={() => setIdx(at + 1)}>›</button>
                    <div className="profile-dots">
                      {photos.map((_, i) => (
                        <button key={i} type="button" className={`profile-dot ${i === at ? 'on' : ''}`} title={`Photo ${i + 1}`} onClick={() => setIdx(i)} />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="profile-nophoto muted">
                {profile === undefined ? 'Loading…'
                  : profile === null ? 'No photos cached yet — run Refresh profiles in Settings → My Haven.'
                  : 'No photos on this profile.'}
              </div>
            )}
            {profile?.url && (
              <button type="button" className="profile-refresh" disabled={refreshing}
                title="Re-fetch this profile's latest photos from My Haven"
                onClick={onRefresh}>
                <span className={`profile-refresh-ic${refreshing ? ' spin' : ''}`}>↻</span>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </div>

          <div className="profile-text">
            {textLines && textLines.length ? (
              textLines.map((spans, li) => (
                <div className="profile-text-line" key={li}>{spans.length ? spans.map(renderSpan) : ' '}</div>
              ))
            ) : (
              <div className="muted">The profile text is captured from the game when you pull it up in-game. Pull up @{handle} in-game, then open this again.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
