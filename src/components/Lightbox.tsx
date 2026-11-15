import { useEffect, useState } from 'react';

/**
 * A full-window image viewer over a dimmed backdrop, opened by clicking an image link in the output.
 * Esc or a click outside the image closes it; an explicit ✕ and "Open in browser" are always there.
 * The image is only fetched now, on this deliberate open — nothing auto-loads — so viewing one is the
 * same disclosure as following any link. A dead link or a non-image URL lands on the error state with
 * a browser fallback. Uses the .modal-backdrop class so the command box won't grab the next keystroke
 * while it's up.
 */
export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  // Clicking a second image while one is open swaps the src — start it loading again.
  useEffect(() => { setStatus('loading'); }, [url]);

  // Capture-phase Escape so it closes the lightbox WITHOUT the command box also seeing it (the box
  // clears itself on Escape, and focus may still be in it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // A readable caption: the file name from the path, falling back to the whole URL.
  let name = url;
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || url) || url; } catch { /* keep url */ }

  const openExternal = () => window.lantern.app.openExternal(url);

  return (
    <div
      className="modal-backdrop lightbox-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="lightbox">
        <div className="lightbox-bar">
          <span className="lightbox-name" title={url}>{name}</span>
          <div className="lightbox-actions">
            <button type="button" className="btn small ghost" onClick={openExternal} title="Open in your web browser">Open in browser</button>
            <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)" autoFocus>✕</button>
          </div>
        </div>
        <div className="lightbox-stage" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          {status === 'error' ? (
            <div className="lightbox-fail">
              <p>Couldn't load this image.</p>
              <button type="button" className="btn small" onClick={openExternal}>Open in browser instead</button>
            </div>
          ) : (
            <img
              className="lightbox-img"
              src={url}
              alt={name}
              style={{ visibility: status === 'ok' ? 'visible' : 'hidden' }}
              onLoad={() => setStatus('ok')}
              onError={() => setStatus('error')}
            />
          )}
          {status === 'loading' && <div className="lightbox-spin muted">Loading…</div>}
        </div>
      </div>
    </div>
  );
}
