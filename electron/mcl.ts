/**
 * MUSHclient .MCL world-file import. Pure functions (no Electron) so the test
 * script can exercise them directly.
 */
import type { World, Trigger, Alias, Timer, SendTo } from '../shared/types';

const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Attributes of one XML start tag → map. Values are entity-decoded. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** Every <name ...>...</name> element of the file. */
function elements(xml: string, name: string): { attrs: Record<string, string>; body: string }[] {
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'g');
  const out: { attrs: Record<string, string>; body: string }[] = [];
  for (const m of xml.matchAll(re)) out.push({ attrs: attrs(m[1]), body: m[2] });
  return out;
}

function sendText(body: string): string {
  const m = body.match(/<send>([\s\S]*?)<\/send>/);
  return m ? decode(m[1]).replace(/\r/g, '').replace(/\n+$/, '') : '';
}

const yes = (v: string | undefined) => v === 'y';

/**
 * MUSHclient's "send to" codes. 0 world, 1 command window, 2 output, 3 status,
 * 5 notepad, 9 speedwalk, 10 variable, 12 script, 14 execute (world, aliases applied).
 */
function sendTo(code: string | undefined): SendTo | 'script' {
  if (code === '12') return 'script';
  if (code === '2' || code === '3' || code === '5') return 'output';
  return 'world';
}

/** Default MUSHclient custom colours 1..16, mapped onto the nearest ANSI palette slot. */
const CUSTOM_COLOUR_ANSI = ['9', '10', '12', '11', '13', '14', '15', '1', '2', '4', '3', '5', '6', '7', '8', '0'];

function highlightOf(a: Record<string, string>): string | null {
  const custom = Number(a.custom_colour ?? 0);
  if (custom === 17) {
    const c = a.other_text_colour;
    return c && c.toLowerCase() !== 'black' ? c : null;
  }
  if (custom >= 1 && custom <= 16) return CUSTOM_COLOUR_ANSI[custom - 1];
  return null;
}

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function withScript<T extends { send: string; script?: string; scriptBody?: string }>(
  item: T, a: Record<string, string>, body: string,
): T {
  const target = sendTo(a.send_to);
  if (a.script) item.script = a.script;
  if (target === 'script') {
    item.scriptBody = sendText(body);
    item.send = '';
  } else {
    item.send = sendText(body);
    (item as unknown as { sendTo: SendTo }).sendTo = target;
  }
  return item;
}

export function importMclTriggers(xml: string): Trigger[] {
  return elements(xml, 'trigger')
    .map(({ attrs: a, body }) => {
      const regex = yes(a.regexp);
      const t: Trigger = {
        id: uid('t'),
        name: a.name ?? '',
        pattern: a.match ?? '',
        regex,
        enabled: yes(a.enabled),
        group: a.group ?? '',
        ignoreCase: yes(a.ignore_case),
        send: '',
        sendTo: 'world',
        highlight: highlightOf(a),
        // MUSHclient recolours just the match for regex triggers and the whole line for wildcard ones.
        highlightLine: !regex,
        gag: yes(a.omit_from_output),
        oneShot: yes(a.one_shot),
      };
      return { seq: Number(a.sequence ?? 100), t: withScript(t, a, body) };
    })
    .filter(({ t }) => t.pattern)
    .sort((x, y) => x.seq - y.seq)
    .map(({ t }) => t);
}

export function importMclAliases(xml: string): Alias[] {
  return elements(xml, 'alias')
    .map(({ attrs: a, body }) => {
      const al: Alias = {
        id: uid('a'),
        name: a.name ?? '',
        pattern: a.match ?? '',
        regex: yes(a.regexp),
        enabled: yes(a.enabled),
        group: a.group ?? '',
        ignoreCase: yes(a.ignore_case),
        send: '',
        sendTo: 'world',
      };
      return { seq: Number(a.sequence ?? 100), al: withScript(al, a, body) };
    })
    .filter(({ al }) => al.pattern)
    .sort((x, y) => x.seq - y.seq)
    .map(({ al }) => al);
}

export function importMclTimers(xml: string): Timer[] {
  return elements(xml, 'timer').map(({ attrs: a, body }) => {
    const h = Number(a.hour ?? 0), m = Number(a.minute ?? 0), s = Math.round(Number(a.second ?? 0));
    const atTime = yes(a.at_time);
    const t: Timer = {
      id: uid('tm'),
      name: a.name ?? '',
      enabled: yes(a.enabled),
      group: a.group ?? '',
      everySeconds: atTime ? 0 : Math.max(1, h * 3600 + m * 60 + s),
      at: atTime ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` + (s ? `:${String(s).padStart(2, '0')}` : '') : null,
      send: '',
      sendTo: 'world',
      oneShot: yes(a.one_shot),
    };
    return withScript(t, a, body);
  });
}

/** Pull the useful bits out of a MUSHclient .MCL world file. */
export function importMcl(xml: string): Partial<World> {
  const attr = (name: string) => {
    const m = xml.match(new RegExp('\\b' + name + '="([^"]*)"'));
    return m ? decode(m[1]) : undefined;
  };
  const w: Partial<World> = {};
  const name = attr('name'); if (name) w.name = name;
  const site = attr('site'); if (site) w.host = site;
  // The world's own port is on its own indented line; chat_port / proxy_port carry prefixes.
  const portMatch = xml.match(/\n\s+port="(\d+)"/);
  if (portMatch) w.port = Number(portMatch[1]);
  w.encoding = attr('utf_8') === 'y' ? 'utf-8' : 'latin1';
  const log = attr('log_output'); if (log) w.logging = log === 'y';
  const conn = attr('connect_text');
  if (conn) w.autoConnect = conn;

  w.triggers = importMclTriggers(xml);
  w.aliases = importMclAliases(xml);
  w.timers = importMclTimers(xml);

  w.commandStacking = attr('enable_command_stack') === 'y';
  const stack = attr('command_stack_character'); if (stack) w.commandStackChar = stack;
  w.speedwalk = attr('enable_speed_walk') === 'y';
  const swp = attr('speed_walk_prefix'); if (swp) w.speedwalkPrefix = swp;
  return w;
}
