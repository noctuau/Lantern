/**
 * In-app updates, the pure part: version comparison and reading a GitHub release into
 * what the About tab shows. No Electron or Node here so scripts/test-updates.mjs can run it.
 *
 * Lantern is released by hand (RELEASE.md): a GitHub Release tagged v<version> with two
 * assets, `Lantern-<version>-x64.exe` (the NSIS installer) and `Lantern-<version>-portable.exe`.
 * The app asks the Releases API for the latest one and offers the asset matching how it is
 * running. There is no electron-updater feed, so "install" means running the downloaded
 * installer (which replaces the installed copy) or, for the portable build, showing the new
 * file so the user can swap it in.
 */

export const UPDATE_REPO = 'noctuau/Lantern';
export const REPO_URL = `https://github.com/${UPDATE_REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues/new`;
export const LATEST_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
/** Release assets are only ever downloaded from here. */
export const DOWNLOAD_PREFIX = `${REPO_URL}/releases/download/`;

export type UpdateFlavour = 'installer' | 'portable';

export interface ReleaseAsset { name: string; url: string; size: number }

export interface UpdateInfo {
  current: string;        // the running version
  latest: string;         // the newest release's version (tag without the v)
  newer: boolean;         // latest > current
  name: string;           // release title
  notes: string;          // release body (Markdown, shown as plain text)
  publishedAt: string;    // ISO date
  url: string;            // the release page
  asset: ReleaseAsset | null;   // the download for this flavour, if the release has one
  flavour: UpdateFlavour;
}

/** "v0.3.1", "0.3.1" or "0.3.1-beta.2" → [0, 3, 1]; null when there is no number in it. */
export function parseVersion(v: string): number[] | null {
  const m = /^\s*v?(\d+(?:\.\d+)*)/i.exec(v);
  if (!m) return null;
  return m[1].split('.').map((n) => Number(n));
}

/** Compare two version strings numerically, part by part; a missing part is 0. Unparseable sorts lowest. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The asset for this flavour: the portable exe, or the (non-portable) installer exe. */
export function pickAsset(assets: readonly ReleaseAsset[], flavour: UpdateFlavour): ReleaseAsset | null {
  const portable = (a: ReleaseAsset) => /-portable\.exe$/i.test(a.name);
  const exe = (a: ReleaseAsset) => /\.exe$/i.test(a.name);
  const pick = flavour === 'portable' ? assets.find(portable) : assets.find((a) => exe(a) && !portable(a));
  return pick ?? null;
}

/** Read the GitHub "latest release" JSON into an UpdateInfo. Throws on a shape we do not recognise. */
export function describeRelease(json: unknown, current: string, flavour: UpdateFlavour): UpdateInfo {
  const r = json as { tag_name?: unknown; name?: unknown; body?: unknown; published_at?: unknown; html_url?: unknown; assets?: unknown };
  if (!r || typeof r !== 'object' || typeof r.tag_name !== 'string') throw new Error('Unexpected reply from GitHub (no release tag)');
  const latest = r.tag_name.replace(/^v/i, '');
  const assets: ReleaseAsset[] = Array.isArray(r.assets)
    ? r.assets
      .filter((a): a is { name: string; browser_download_url: string; size?: unknown } =>
        !!a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string' && typeof (a as { browser_download_url?: unknown }).browser_download_url === 'string')
      .filter((a) => a.browser_download_url.startsWith(DOWNLOAD_PREFIX))
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: typeof a.size === 'number' ? a.size : 0 }))
    : [];
  return {
    current,
    latest,
    newer: compareVersions(latest, current) > 0,
    name: typeof r.name === 'string' && r.name ? r.name : `Lantern ${latest}`,
    notes: typeof r.body === 'string' ? r.body : '',
    publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
    url: typeof r.html_url === 'string' ? r.html_url : RELEASES_URL,
    asset: pickAsset(assets, flavour),
    flavour,
  };
}

/** "112679048" → "107 MB". */
export function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
