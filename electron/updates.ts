/**
 * In-app updates, the Electron side: ask GitHub for the latest release, download the asset for
 * this build into the temp folder, and hand it to the user (run the installer, or show the new
 * portable exe). The renderer's CSP allows no outside requests, so all of this lives in main.
 * The pure parts (version compare, reading the release JSON) are in shared/updates.ts.
 */
import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { describeRelease, DOWNLOAD_PREFIX, LATEST_API_URL, type ReleaseAsset, type UpdateFlavour, type UpdateInfo } from '../shared/updates';

const CHECK_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const userAgent = () => `Lantern/${app.getVersion()} (+https://github.com/noctuau/Lantern)`;

/** electron-builder's portable target sets this to the exe's path when it runs. */
export function updateFlavour(): UpdateFlavour {
  return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer';
}

export interface AboutInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  packaged: boolean;
  flavour: UpdateFlavour;
}

export function aboutInfo(): AboutInfo {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged,
    flavour: updateFlavour(),
  };
}

/** The latest GitHub release, compared with the running version. Throws on network or API trouble. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(LATEST_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent() },
      signal: ctrl.signal,
    });
    if (res.status === 404) throw new Error('No releases found on GitHub yet.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`.trim());
    return describeRelease(await res.json(), app.getVersion(), updateFlavour());
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('GitHub did not answer within 10 seconds.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const updatesDir = () => path.join(app.getPath('temp'), 'lantern-updates');

/**
 * Download a release asset to the temp folder, reporting progress. Only assets from this
 * project's GitHub releases are accepted, whatever the renderer asks for. Returns the file path.
 */
export async function downloadUpdate(asset: ReleaseAsset, onProgress: (received: number, total: number) => void): Promise<string> {
  if (typeof asset?.url !== 'string' || !asset.url.startsWith(DOWNLOAD_PREFIX)) throw new Error('Refusing to download from outside the Lantern releases.');
  const name = path.basename(String(asset.name || 'Lantern-update.exe')).replace(/[^\w.-]/g, '_');
  if (!/\.exe$/i.test(name)) throw new Error('The release asset is not a Windows executable.');
  const dir = updatesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const part = file + '.part';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(asset.url, { headers: { 'User-Agent': userAgent() }, signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed: GitHub answered ${res.status}`);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    let received = 0;
    onProgress(0, total);
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) { received += chunk.length; onProgress(received, total); cb(null, chunk); },
    });
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), counter, fs.createWriteStream(part));
    const size = fs.statSync(part).size;
    if (asset.size && size !== asset.size) throw new Error(`Download incomplete (${size} of ${asset.size} bytes).`);
    fs.rmSync(file, { force: true });
    fs.renameSync(part, file);
    return file;
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch { /* nothing to clean */ }
    if ((e as Error).name === 'AbortError') throw new Error('The download took too long and was stopped.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Installer: start it and quit, so it can replace the installed files (it walks the user through
 * the usual pages). Portable: there is no installing to do; show the new exe beside the old one.
 */
export async function installUpdate(file: string, flavour: UpdateFlavour): Promise<'launched' | 'shown'> {
  const dir = updatesDir();
  const resolved = path.resolve(file);
  if (!resolved.startsWith(dir + path.sep) || !fs.existsSync(resolved)) throw new Error('That download is no longer there. Download it again.');
  if (flavour === 'portable') { shell.showItemInFolder(resolved); return 'shown'; }
  const err = await shell.openPath(resolved);
  if (err) throw new Error(err);
  setTimeout(() => app.quit(), 1200);
  return 'launched';
}
