/**
 * Per-world automation: triggers, aliases, timers, the Lua script and the
 * command options. Edits a draft copy of the world; nothing is persisted until
 * Save. The Script tab is separate: it reads and writes the world's script
 * file directly and asks the app to reload it into any live session.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { World, Trigger, Alias, Timer, SendTo } from '../../shared/types';
import { normalizeTrigger, normalizeAlias, normalizeTimer } from '../../shared/types';
import { runTriggers, applyHighlights, patternError, describeTimer, expandCommand } from '../lib/automation';
import { spanStyle, EMPTY_STYLE } from '../lib/ansi';

type Tab = 'triggers' | 'aliases' | 'timers' | 'script' | 'options';
type Item = Trigger | Alias | Timer;
type ListKey = 'triggers' | 'aliases' | 'timers';
const LIST_TABS: ListKey[] = ['triggers', 'aliases', 'timers'];
const isList = (t: Tab): t is ListKey => (LIST_TABS as Tab[]).includes(t);

interface Props {
  world: World;
  initialTab?: Tab;
  onSave(w: World): void;
  /** The script file changed on disk: start a fresh Lua state in every session on this world. */
  onReloadScript(): void;
  onClose(): void;
}

const ANSI_NAMES = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
  'Grey', 'Bright red', 'Bright green', 'Bright yellow', 'Bright blue', 'Bright magenta', 'Bright cyan', 'Bright white'];

const colourCss = (c: string) => (/^\d+$/.test(c) ? `var(--ansi-${c})` : c);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export function AutomationPanel({ world, initialTab, onSave, onReloadScript, onClose }: Props) {
  const [w, setW] = useState<World>(() => JSON.parse(JSON.stringify(world)) as World);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'triggers');
  const [sel, setSel] = useState<string | null>(initialTab && !isList(initialTab) ? null : (world.triggers[0]?.id ?? null));
  const [test, setTest] = useState('');
  const [scriptDirty, setScriptDirty] = useState(false);
  const worldDirty = useMemo(() => JSON.stringify(w) !== JSON.stringify(world), [w, world]);
  const dirty = worldDirty || scriptDirty;

  const list: Item[] = isList(tab) ? w[tab] : [];
  const selected = list.find((x) => x.id === sel) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dirty) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  const switchTab = (t: Tab) => { setTab(t); setSel(isList(t) ? (w[t][0]?.id ?? null) : null); };

  const setList = (key: ListKey, items: Item[]) => setW((x) => ({ ...x, [key]: items }));
  const patch = (patchObj: Partial<Item>) => {
    if (!isList(tab) || !selected) return;
    setList(tab, list.map((x) => (x.id === selected.id ? { ...x, ...patchObj } as Item : x)));
  };

  const addItem = () => {
    if (!isList(tab)) return;
    const id = uid();
    const item: Item = tab === 'triggers' ? normalizeTrigger({ id })
      : tab === 'aliases' ? normalizeAlias({ id })
      : normalizeTimer({ id });
    setList(tab, [...list, item]);
    setSel(id);
  };
  const duplicate = () => {
    if (!isList(tab) || !selected) return;
    const id = uid();
    const copy = { ...selected, id, name: selected.name ? `${selected.name} (copy)` : '' } as Item;
    const i = list.findIndex((x) => x.id === selected.id);
    setList(tab, [...list.slice(0, i + 1), copy, ...list.slice(i + 1)]);
    setSel(id);
  };
  const remove = () => {
    if (!isList(tab) || !selected) return;
    const i = list.findIndex((x) => x.id === selected.id);
    const next = list.filter((x) => x.id !== selected.id);
    setList(tab, next);
    setSel(next[Math.min(i, next.length - 1)]?.id ?? null);
  };
  const move = (dir: -1 | 1) => {
    if (!isList(tab) || !selected) return;
    const i = list.findIndex((x) => x.id === selected.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setList(tab, next);
  };

  const groups = useMemo(() => {
    const m = new Map<string, { on: number; total: number }>();
    for (const it of list) {
      if (!it.group) continue;
      const g = m.get(it.group) ?? { on: 0, total: 0 };
      g.total++; if (it.enabled) g.on++;
      m.set(it.group, g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list]);
  const toggleGroup = (g: string, on: boolean) => {
    if (!isList(tab)) return;
    setList(tab, list.map((x) => (x.group === g ? { ...x, enabled: on } as Item : x)));
  };

  const counts: Partial<Record<Tab, number>> = { triggers: w.triggers.length, aliases: w.aliases.length, timers: w.timers.length };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !dirty) onClose(); }}>
      <div className="modal auto">
        <div className="auto-head">
          <div>
            <h2>Automation</h2>
            <div className="muted small">{w.name}</div>
          </div>
          <div className="auto-tabs">
            {(['triggers', 'aliases', 'timers', 'script', 'options'] as Tab[]).map((t) => (
              <button key={t} className={`auto-tab ${tab === t ? 'active' : ''}`} onClick={() => switchTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
                {(counts[t] ?? 0) > 0 && <span className="count">{counts[t]}</span>}
                {t === 'script' && scriptDirty && <span className="count" title="Unsaved script">●</span>}
              </button>
            ))}
          </div>
        </div>

        {tab === 'options' ? (
          <OptionsTab w={w} setW={setW} />
        ) : tab === 'script' ? (
          <ScriptTab worldId={w.id} onDirty={setScriptDirty} onReload={onReloadScript} />
        ) : (
          <div className="auto-body">
            <div className="auto-side">
              {groups.length > 0 && (
                <div className="chips" title="Click a group to turn all of it on or off">
                  {groups.map(([g, c]) => (
                    <button key={g} className={`chip ${c.on === 0 ? 'off' : c.on < c.total ? 'mixed' : ''}`} onClick={() => toggleGroup(g, c.on === 0)}>
                      {g} <span className="muted">{c.on}/{c.total}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="auto-list">
                {list.length === 0 && (
                  <div className="muted small pad">
                    {tab === 'triggers' && 'No triggers yet. A trigger watches the game\'s output and can colour, hide, or respond to a line.'}
                    {tab === 'aliases' && 'No aliases yet. An alias turns something short you type into something longer.'}
                    {tab === 'timers' && 'No timers yet. A timer sends something on a schedule while you are connected.'}
                  </div>
                )}
                {list.map((it) => (
                  <div key={it.id} className={`auto-item ${it.id === sel ? 'selected' : ''} ${it.enabled ? '' : 'disabled'}`} onClick={() => setSel(it.id)}>
                    <input type="checkbox" checked={it.enabled} title="Enabled" onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setList(tab, list.map((x) => (x.id === it.id ? { ...x, enabled: e.target.checked } as Item : x)))} />
                    <div className="auto-item-main">
                      <div className="auto-item-title">{itemTitle(tab, it)}</div>
                      <div className="auto-item-sub muted">{itemSub(tab, it)}</div>
                    </div>
                    {'highlight' in it && it.highlight && <span className="swatch" style={{ background: colourCss(it.highlight) }} />}
                  </div>
                ))}
              </div>
              <div className="auto-list-actions">
                <button className="btn small" onClick={addItem}>+ New</button>
                <button className="btn small ghost" disabled={!selected} onClick={duplicate}>Duplicate</button>
                <span className="spacer" />
                <button className="icon-btn" title="Move up" disabled={!selected} onClick={() => move(-1)}>↑</button>
                <button className="icon-btn" title="Move down" disabled={!selected} onClick={() => move(1)}>↓</button>
                <button className="btn small ghost danger" disabled={!selected} onClick={remove}>Delete</button>
              </div>
            </div>

            <div className="auto-editor">
              {!selected && <div className="muted pad">Select an item on the left, or add a new one.</div>}
              {selected && tab === 'triggers' && <TriggerEditor t={selected as Trigger} patch={patch} />}
              {selected && tab === 'aliases' && <AliasEditor a={selected as Alias} patch={patch} />}
              {selected && tab === 'timers' && <TimerEditor t={selected as Timer} patch={patch} />}

              {tab === 'triggers' && <TriggerTest triggers={w.triggers} text={test} setText={setTest} />}
              {tab === 'aliases' && <AliasTest world={w} />}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <span className="muted small">{worldDirty ? 'Unsaved changes' : scriptDirty ? 'Script not saved (use Save script above)' : 'Saved'}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>{dirty ? 'Discard' : 'Close'}</button>
          <button type="button" className="btn primary" disabled={!worldDirty} onClick={() => onSave(w)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function itemTitle(tab: Tab, it: Item): string {
  if (it.name) return it.name;
  if ('pattern' in it) return it.pattern || '(empty pattern)';
  return (it as Timer).send.split('\n')[0] || '(nothing to send)';
}

function itemSub(tab: Tab, it: Item): string {
  const bits: string[] = [];
  if (tab === 'triggers') {
    const t = it as Trigger;
    if (t.name) bits.push(t.pattern);
    if (t.regex) bits.push('regex');
    if (t.gag) bits.push('gag');
    if (t.oneShot) bits.push('once');
    if (t.send) bits.push(t.sendTo === 'output' ? 'note' : 'sends');
    if (t.script) bits.push(`lua ${t.script}`);
  } else if (tab === 'aliases') {
    const a = it as Alias;
    if (a.name) bits.push(a.pattern);
    bits.push('→ ' + (a.send.split('\n')[0] || (a.script ? `lua ${a.script}` : '')));
  } else {
    const t = it as Timer;
    bits.push(describeTimer(t));
    if (t.name && t.send) bits.push(t.send.split('\n')[0]);
    if (t.oneShot) bits.push('once');
  }
  if (it.group) bits.push(`#${it.group}`);
  return bits.join(' · ');
}

/* ---------- editors ---------- */

function Field({ label, children, grow, hint }: { label: string; children: React.ReactNode; grow?: boolean; hint?: string }) {
  return (
    <label className={grow ? 'grow' : ''}>
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange(v: boolean): void; title?: string }) {
  return (
    <label className="check inline" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function SendToSelect({ value, onChange }: { value: SendTo; onChange(v: SendTo): void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as SendTo)}>
      <option value="world">to the game</option>
      <option value="output">to the output pane, as a note</option>
    </select>
  );
}

function TriggerEditor({ t, patch }: { t: Trigger; patch(p: Partial<Trigger>): void }) {
  const err = patternError(t.pattern, t.regex);
  const custom = t.highlight !== null && !/^\d+$/.test(t.highlight);
  return (
    <div className="auto-form">
      <div className="row">
        <Field label="Name" grow><input value={t.name} onChange={(e) => patch({ name: e.target.value })} placeholder="What this trigger is for" /></Field>
        <Field label="Group"><input value={t.group} onChange={(e) => patch({ group: e.target.value })} placeholder="optional" style={{ width: 140 }} /></Field>
      </div>
      <Field label="Match" hint={err ?? (t.regex ? 'JavaScript regular expression. Captures become %1, %2 …' : 'Plain text anywhere in the line. Use * as a wildcard; a pattern with * must match the whole line, and each * becomes %1, %2 …')}>
        <input className={`mono ${err ? 'invalid' : ''}`} value={t.pattern} onChange={(e) => patch({ pattern: e.target.value })} placeholder={t.regex ? '^(\\w+) pages: (.*)$' : '* tells you *'} spellCheck={false} />
      </Field>
      <div className="row wrap">
        <Check label="Regular expression" checked={t.regex} onChange={(v) => patch({ regex: v, highlightLine: v ? t.highlightLine : true })} />
        <Check label="Ignore case" checked={t.ignoreCase} onChange={(v) => patch({ ignoreCase: v })} />
        <Check label="Hide the line (gag)" checked={t.gag} onChange={(v) => patch({ gag: v })} />
        <Check label="Fire once, then disable" checked={t.oneShot} onChange={(v) => patch({ oneShot: v })} />
      </div>
      <div className="row">
        <Field label="Colour" grow>
          <div className="row">
            <select value={t.highlight === null ? '' : custom ? 'custom' : t.highlight}
              onChange={(e) => patch({ highlight: e.target.value === '' ? null : e.target.value === 'custom' ? '#e8a94b' : e.target.value })}>
              <option value="">No colour change</option>
              {ANSI_NAMES.map((n, i) => <option key={i} value={String(i)}>{n}</option>)}
              <option value="custom">Custom…</option>
            </select>
            {custom && <input className="mono" style={{ width: 120 }} value={t.highlight ?? ''} onChange={(e) => patch({ highlight: e.target.value })} placeholder="#rrggbb" />}
            {t.highlight && <span className="swatch big" style={{ background: colourCss(t.highlight) }} />}
          </div>
        </Field>
        {t.highlight && (
          <Check label="Whole line" title="Otherwise only the matching text is coloured" checked={t.highlightLine} onChange={(v) => patch({ highlightLine: v })} />
        )}
      </div>
      <Field label="Send" hint="One command per line. %0 is the whole match, %1–%9 the captures. Leave empty for a colour-only trigger.">
        <textarea rows={3} value={t.send} onChange={(e) => patch({ send: e.target.value })} spellCheck={false} />
      </Field>
      <div className="row">
        <Field label="Send it" grow><SendToSelect value={t.sendTo} onChange={(v) => patch({ sendTo: v })} /></Field>
        <Field label="Lua function" hint="From the Script tab; called as fn(name, line, wildcards) after the send." grow>
          <input className="mono" value={t.script ?? ''} onChange={(e) => patch({ script: e.target.value || undefined })} placeholder="on_tell" spellCheck={false} />
        </Field>
      </div>
      <InlineLua value={t.scriptBody} onChange={(v) => patch({ scriptBody: v })} />
    </div>
  );
}

function InlineLua({ value, onChange }: { value?: string; onChange(v: string | undefined): void }) {
  const [open, setOpen] = useState(!!value);
  if (!open && !value) return <button type="button" className="btn small ghost self-start" onClick={() => setOpen(true)}>+ Inline Lua</button>;
  return (
    <Field label="Inline Lua" hint="Runs when it fires, after the send. %1–%9 are substituted into the text first; `local name, line, wildcards = ...` gets the rest.">
      <textarea className="mono" rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} spellCheck={false} placeholder='Note("matched %1")' />
    </Field>
  );
}

function AliasEditor({ a, patch }: { a: Alias; patch(p: Partial<Alias>): void }) {
  const err = patternError(a.pattern, a.regex);
  return (
    <div className="auto-form">
      <div className="row">
        <Field label="Name" grow><input value={a.name} onChange={(e) => patch({ name: e.target.value })} placeholder="optional" /></Field>
        <Field label="Group"><input value={a.group} onChange={(e) => patch({ group: e.target.value })} placeholder="optional" style={{ width: 140 }} /></Field>
      </div>
      <Field label="When I type" hint={err ?? (a.regex ? 'Regular expression matched against the whole command. Captures become %1, %2 …' : 'A command word: "gg" matches "gg sword" and %1 is "sword". Or use * wildcards to match the whole command.')}>
        <input className={`mono ${err ? 'invalid' : ''}`} value={a.pattern} onChange={(e) => patch({ pattern: e.target.value })} placeholder={a.regex ? '^gg (.*)$' : 'gg'} spellCheck={false} />
      </Field>
      <div className="row wrap">
        <Check label="Regular expression" checked={a.regex} onChange={(v) => patch({ regex: v })} />
        <Check label="Ignore case" checked={a.ignoreCase} onChange={(v) => patch({ ignoreCase: v })} />
      </div>
      <Field label="Send instead" hint="One command per line. %0 is what you typed, %1–%9 the captures.">
        <textarea rows={3} value={a.send} onChange={(e) => patch({ send: e.target.value })} spellCheck={false} />
      </Field>
      <div className="row">
        <Field label="Send it" grow><SendToSelect value={a.sendTo} onChange={(v) => patch({ sendTo: v })} /></Field>
        <Field label="Lua function" hint="From the Script tab; called as fn(name, command, wildcards) after the send." grow>
          <input className="mono" value={a.script ?? ''} onChange={(e) => patch({ script: e.target.value || undefined })} placeholder="do_greet" spellCheck={false} />
        </Field>
      </div>
      <InlineLua value={a.scriptBody} onChange={(v) => patch({ scriptBody: v })} />
    </div>
  );
}

function TimerEditor({ t, patch }: { t: Timer; patch(p: Partial<Timer>): void }) {
  const mode = t.at !== null ? 'at' : 'every';
  const h = Math.floor(t.everySeconds / 3600), m = Math.floor((t.everySeconds % 3600) / 60), s = t.everySeconds % 60;
  const setHms = (hh: number, mm: number, ss: number) => patch({ everySeconds: Math.max(1, hh * 3600 + mm * 60 + ss) });
  return (
    <div className="auto-form">
      <div className="row">
        <Field label="Name" grow><input value={t.name} onChange={(e) => patch({ name: e.target.value })} placeholder="optional" /></Field>
        <Field label="Group"><input value={t.group} onChange={(e) => patch({ group: e.target.value })} placeholder="optional" style={{ width: 140 }} /></Field>
      </div>
      <div className="row">
        <Field label="Fires">
          <select value={mode} onChange={(e) => patch(e.target.value === 'at' ? { at: '09:00' } : { at: null })}>
            <option value="every">every</option>
            <option value="at">daily at</option>
          </select>
        </Field>
        {mode === 'every' ? (
          <>
            <Field label="Hours"><input type="number" min={0} max={99} value={h} onChange={(e) => setHms(Number(e.target.value), m, s)} style={{ width: 70 }} /></Field>
            <Field label="Minutes"><input type="number" min={0} max={59} value={m} onChange={(e) => setHms(h, Number(e.target.value), s)} style={{ width: 70 }} /></Field>
            <Field label="Seconds"><input type="number" min={0} max={59} value={s} onChange={(e) => setHms(h, m, Number(e.target.value))} style={{ width: 70 }} /></Field>
          </>
        ) : (
          <Field label="Time (24h)"><input type="time" value={t.at ?? ''} onChange={(e) => patch({ at: e.target.value || '00:00' })} /></Field>
        )}
        <span className="spacer" />
        <Check label="Fire once, then disable" checked={t.oneShot} onChange={(v) => patch({ oneShot: v })} />
      </div>
      <Field label="Send" hint="One command per line. Timers only run while you are connected.">
        <textarea rows={3} value={t.send} onChange={(e) => patch({ send: e.target.value })} spellCheck={false} />
      </Field>
      <div className="row">
        <Field label="Send it" grow><SendToSelect value={t.sendTo} onChange={(v) => patch({ sendTo: v })} /></Field>
        <Field label="Lua function" hint="From the Script tab; called as fn(name) after the send." grow>
          <input className="mono" value={t.script ?? ''} onChange={(e) => patch({ script: e.target.value || undefined })} placeholder="on_tick" spellCheck={false} />
        </Field>
      </div>
      <InlineLua value={t.scriptBody} onChange={(v) => patch({ scriptBody: v })} />
    </div>
  );
}

/* ---------- test boxes ---------- */

function TriggerTest({ triggers, text, setText }: { triggers: Trigger[]; text: string; setText(v: string): void }) {
  const lines = text.split('\n').filter((l) => l.length > 0);
  return (
    <div className="auto-test">
      <div className="auto-test-head">
        <span>Try it</span>
        <span className="muted small">Paste a line or two of game output to see which triggers would fire.</span>
      </div>
      <textarea className="mono" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Someone tells you, &quot;hello there&quot;" spellCheck={false} />
      {lines.map((line, i) => {
        const r = runTriggers(triggers, line);
        const spans = applyHighlights([{ text: line, style: EMPTY_STYLE }], r.highlights);
        return (
          <div key={i} className="auto-test-result">
            <div className={`mono preview ${r.gag ? 'gagged' : ''}`}>
              {spans.map((sp, k) => <span key={k} style={spanStyle(sp.style)}>{sp.text}</span>)}
              {r.gag && <span className="muted"> (hidden)</span>}
            </div>
            {r.fired.length === 0
              ? <div className="muted small">No trigger matches.</div>
              : (
                <div className="small">
                  Fires: {r.fired.map((t) => t.name || t.pattern).join(', ')}
                  {r.outgoing.map((o, k) => <div key={k} className="mono muted">{o.sendTo === 'output' ? '(note) ' : '› '}{o.text}</div>)}
                </div>
              )}
          </div>
        );
      })}
    </div>
  );
}

function AliasTest({ world }: { world: World }) {
  const [text, setText] = useState('');
  const r = text ? expandCommand(world, text) : null;
  return (
    <div className="auto-test">
      <div className="auto-test-head">
        <span>Try it</span>
        <span className="muted small">Type a command to see what would be sent.</span>
      </div>
      <input className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="gg sword" spellCheck={false} />
      {r && (
        <div className="auto-test-result small">
          {r.aliasesUsed.length ? `Alias: ${r.aliasesUsed.map((a) => a.name || a.pattern).join(', ')}` : 'No alias matches; sent as typed.'}
          {r.outgoing.map((o, k) => <div key={k} className="mono muted">{o.sendTo === 'output' ? '(note) ' : '› '}{o.text}</div>)}
        </div>
      )}
    </div>
  );
}

/* ---------- script ---------- */

function ScriptTab({ worldId, onDirty, onReload }: { worldId: string; onDirty(d: boolean): void; onReload(): void }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [file, setFile] = useState('');
  const [status, setStatus] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== null && text !== saved;

  useEffect(() => {
    let live = true;
    window.lantern.scripts.read(worldId).then((t) => { if (live) { setText(t); setSaved(t); } });
    window.lantern.scripts.path(worldId).then((p) => { if (live) setFile(p); });
    return () => { live = false; };
  }, [worldId]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const save = async () => {
    if (text === null) return;
    await window.lantern.scripts.write(worldId, text);
    setSaved(text);
    onReload();
    setStatus(`Saved and reloaded at ${new Date().toLocaleTimeString()}`);
  };
  const reload = () => { onReload(); setStatus(`Reloaded at ${new Date().toLocaleTimeString()}`); };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); return; }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b, value } = el;
      const next = value.slice(0, a) + '  ' + value.slice(b);
      setText(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
    }
  };

  return (
    <div className="auto-script">
      <div className="auto-script-head">
        <div>
          <div>Lua script for this world</div>
          <div className="muted small">Runs in every session on this world when it connects. Functions named on triggers, aliases and timers are looked up here.</div>
        </div>
        <span className="spacer" />
        <button className="btn small ghost" title={file} onClick={() => window.lantern.scripts.open(worldId)}>Open in editor</button>
        <button className="btn small ghost" title="Start a fresh Lua state from the file on disk (after editing it elsewhere)" onClick={reload}>Reload</button>
        <button className="btn small primary" disabled={!dirty} onClick={save}>Save script</button>
      </div>
      <textarea
        ref={area}
        className="mono auto-script-text"
        value={text ?? ''}
        placeholder={text === null ? 'Loading…' : '-- Lua 5.4. Define functions here and name them on a trigger, alias or timer:\n\nfunction on_tell(name, line, wildcards)\n  ColourNote("yellow", "", wildcards[1] .. " says: " .. wildcards[2])\nend'}
        spellCheck={false}
        disabled={text === null}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="muted small auto-script-foot">
        <span>{status || (dirty ? 'Unsaved changes (Ctrl+S saves)' : 'Errors from the script show as red lines in the output.')}</span>
        <span className="spacer" />
        <span className="mono" title={file}>{file.split(/[\\/]/).slice(-2).join('/')}</span>
      </div>
    </div>
  );
}

/* ---------- options ---------- */

function OptionsTab({ w, setW }: { w: World; setW: React.Dispatch<React.SetStateAction<World>> }) {
  const set = <K extends keyof World>(k: K, v: World[K]) => setW((x) => ({ ...x, [k]: v }));
  return (
    <div className="auto-options">
      <section>
        <Check label="Command stacking" checked={w.commandStacking} onChange={(v) => set('commandStacking', v)} />
        <p className="muted small">Send several commands at once by separating them with a character. Type it twice to send it literally.</p>
        <div className="row">
          <Field label="Separator"><input className="mono" maxLength={1} value={w.commandStackChar} onChange={(e) => set('commandStackChar', e.target.value || ';')} style={{ width: 60 }} /></Field>
          <div className="example mono muted">look{w.commandStackChar}inventory → look, inventory</div>
        </div>
      </section>
      <section>
        <Check label="Speedwalk" checked={w.speedwalk} onChange={(v) => set('speedwalk', v)} />
        <p className="muted small">A prefix followed by directions with counts. Parentheses send something in the middle verbatim.</p>
        <div className="row">
          <Field label="Prefix"><input className="mono" maxLength={3} value={w.speedwalkPrefix} onChange={(e) => set('speedwalkPrefix', e.target.value || '#')} style={{ width: 60 }} /></Field>
          <div className="example mono muted">{w.speedwalkPrefix}3n2e(open door)u → n n n e e, open door, u</div>
        </div>
      </section>
      <section>
        <p className="muted small">Both are off unless you turn them on here, and apply only to this world. Typed commands run through aliases after being split.</p>
      </section>
    </div>
  );
}
