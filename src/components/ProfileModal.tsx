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

  // The in-game text block captured for this handle (lines of coloured spans).
  const lines = useMemo(() => getProfileCapture(handle), [handle]);

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
          </div>

          <div className="profile-text">
            {lines && lines.length ? (
              lines.map((spans, li) => (
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
