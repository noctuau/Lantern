// A tiny broker between a clicked image link deep in the (memoized) output and the lightbox modal
// that App mounts at the top level. The output's render is cached per line id, so threading a
// callback down through it would fight the cache; instead the link calls openLightbox(url) and App
// subscribes. Display-only, like the rest of the output: nothing here touches the wire or the log.

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;

/**
 * Does this URL point straight at an image? We test the PATH only: image hosts (Discord's CDN,
 * imgur, …) hang a `?ex=…&hm=…` query and sometimes a `#fragment` off the end, so both are stripped
 * before the extension check. A page that merely contains an image (an imgur album page, say) has no
 * image extension and stays an ordinary external link.
 */
export function isImageUrl(url: string): boolean {
  let path = url;
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);
  return IMAGE_EXT_RE.test(path);
}

type LightboxListener = (url: string) => void;
const listeners = new Set<LightboxListener>();

/** Open the image lightbox on this URL (called from a clicked image link in the output). */
export function openLightbox(url: string): void {
  listeners.forEach((fn) => fn(url));
}

/** Subscribe to lightbox-open requests; App mounts the modal. Returns an unsubscribe. */
export function onOpenLightbox(fn: LightboxListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
