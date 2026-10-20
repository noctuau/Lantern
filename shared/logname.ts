/**
 * Log file name patterns. `{world}` is the world name; `%` fields follow strftime
 * (the same ones MUSHclient accepts): %a %A weekday, %b %B month name, %d day,
 * %m month, %y %Y year, %H %M %S time, %j day of year, %p AM/PM, %% literal %.
 * A pattern may be a bare file name (kept in the app's logs folder), a relative
 * path, or an absolute path.
 */
export const DEFAULT_LOG_FILE = '{world} %Y-%m-%d';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function strftime(pattern: string, d: Date): string {
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
  return pattern.replace(/%([a-zA-Z%])/g, (m, f: string) => {
    switch (f) {
      case 'a': return DAYS[d.getDay()].slice(0, 3);
      case 'A': return DAYS[d.getDay()];
      case 'b': return MONTHS[d.getMonth()].slice(0, 3);
      case 'B': return MONTHS[d.getMonth()];
      case 'd': return pad(d.getDate());
      case 'e': return String(d.getDate());
      case 'm': return pad(d.getMonth() + 1);
      case 'y': return pad(d.getFullYear() % 100);
      case 'Y': return String(d.getFullYear());
      case 'H': return pad(d.getHours());
      case 'I': return pad(d.getHours() % 12 || 12);
      case 'M': return pad(d.getMinutes());
      case 'S': return pad(d.getSeconds());
      case 'p': return d.getHours() < 12 ? 'AM' : 'PM';
      case 'j': return pad(dayOfYear, 3);
      case '%': return '%';
      default: return m;
    }
  });
}

/** Characters Windows will not take in a file name. */
export function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'world';
}

/** Expand a pattern to a file name; adds the extension for the format when the pattern has none. */
export function expandLogName(pattern: string, worldName: string, format: 'text' | 'html', d = new Date()): string {
  const base = strftime((pattern || DEFAULT_LOG_FILE).replace(/\{world\}/gi, safeName(worldName)), d);
  const last = base.split(/[\\/]/).pop() ?? '';
  const ext = format === 'html' ? '.html' : '.txt';
  return /\.[a-z0-9]{1,5}$/i.test(last) ? base : base + ext;
}
