/**
 * Per-world automation: triggers, aliases, timers, channel tabs, the Lua
 * script and the command options. Edits a draft copy of the world; nothing is
 * persisted until Save. The Script tab is separate: it reads and writes the
 * world's script file directly and asks the app to reload it into any live session.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { World, Trigger, Alias, Timer, SendTo, ChannelTab, ChannelPattern, ChannelNotify, ChannelMode } from '../../shared/types';
import { normalizeTrigger, normalizeAlias, normalizeTimer, normalizeChannelTab } from '../../shared/types';
import { runTriggers, applyHighlights, patternError, describeTimer, expandCommand } from '../lib/automation';
import { classifyLine, channelPatternError, havenChannelTab, hasHavenPreset, helpChannelTab, hasHelpPreset, HAVEN_TAB_NAME, PREFIX_BYPASS } from '../lib/channels';
import { spanStyle, EMPTY_STYLE } from '../lib/ansi';

export type PanelTab = 'triggers' | 'aliases' | 'timers' | 'channels' | 'script' | 'options';
type Tab = PanelTab;
type Item = Trigger | Alias | Timer;
type ListKey = 'triggers' | 'aliases' | 'timers';
const LIST_TABS: ListKey[] = ['triggers', 'aliases', 'timers'];
const isList = (t: Tab): t is ListKey => (LIST_TABS as Tab[]).includes(t);
const TAB_LABELS: Record<Tab, string> = { triggers: 'Triggers', aliases: 'Aliases', timers: 'Timers', channels: 'Channels', script: 'Script', options: 'Options' };

interface Props {
  world: World;
  initialTab?: Tab;
  onSave(w: World): void;
  /** The script file changed on disk: start a fresh Lua state in every session on this world. */
  onReloadScript(): void;
  onClose(): void;
}

import { ColourPicker, colourCss } from './ColourPicker';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export function AutomationPanel({ world, initialTab, onSave, onReloadScript, onClose }: Props) {
  const [w, setW] = useState<World>(() => JSON.parse(JSON.stringify(world)) as World);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'triggers');
  const [sel, setSel] = useState<string | null>(initialTab && !isList(initialTab) ? null : (world.triggers[0]?.id ?? null));
  const [test, setTest] = useState('');
  const [importMsg, setImportMsg] = useState('');
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

  /** Merge triggers/aliases/timers parsed from MUSHclient XML into the draft, with fresh ids. */
  const applyImport = (items: { triggers: Trigger[]; aliases: Alias[]; timers: Timer[] } | null, source: string) => {
    if (!items) return;
    const n = items.triggers.length + items.aliases.length + items.timers.length;
    if (!n) { setImportMsg(`No MUSHclient triggers, aliases or timers found in ${source}.`); return; }
    const fresh = <T extends { id: string }>(xs: T[]) => xs.map((x) => ({ ...x, id: uid() }));
    setW((x) => ({
      ...x,
      triggers: [...x.triggers, ...fresh(items.triggers)],
      aliases: [...x.aliases, ...fresh(items.aliases)],
      timers: [...x.timers, ...fresh(items.timers)],
    }));
    const parts = [[items.triggers.length, 'trigger'], [items.aliases.length, 'alias'], [items.timers.length, 'timer']] as const;
    const summary = parts.filter(([c]) => c > 0).map(([c, w]) => `${c} ${w}${c === 1 ? '' : w === 'alias' ? 'es' : 's'}`).join(', ');
    setImportMsg(`Imported ${summary} from ${source}. Save to keep them.`);
  };
  const importFile = async () => {
    const res = await window.lantern.mcl.importFile();
    if (res) applyImport(res, res.file);
  };
  const pasteXml = async () => {
    let xml = '';
    try { xml = await navigator.clipboard.readText(); } catch { setImportMsg('Could not read the clipboard.'); return; }
    if (!xml.trim()) { setImportMsg('The clipboard is empty.'); return; }
    applyImport(await window.lantern.mcl.parse(xml), 'the clipboard');
  };
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

  const counts: Partial<Record<Tab, number>> = { triggers: w.triggers.length, aliases: w.aliases.length, timers: w.timers.length, channels: w.channelTabs.length };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !dirty) onClose(); }}>
      <div className="modal auto">
        <div className="auto-head">
          <div>
            <h2>Automation</h2>
            <div className="muted small">{w.name}</div>
          </div>
          <div className="auto-tabs">
            {(['triggers', 'aliases', 'timers', 'channels', 'script', 'options'] as Tab[]).map((t) => (
              <button key={t} className={`auto-tab ${tab === t ? 'active' : ''}`} onClick={() => switchTab(t)}>
                {TAB_LABELS[t]}
                {(counts[t] ?? 0) > 0 && <span className="count">{counts[t]}</span>}
                {t === 'script' && scriptDirty && <span className="count" title="Unsaved script">●</span>}
              </button>
            ))}
          </div>
        </div>

        {tab === 'options' ? (
          <OptionsTab w={w} setW={setW} />
        ) : tab === 'channels' ? (
          <ChannelsTab w={w} setW={setW} />
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
                <button className="btn small ghost" title="Import from a MUSHclient export (.mct, .mca, .mcm, .xml) or world file (.MCL)" onClick={importFile}>Import…</button>
                <button className="btn small ghost" title="Paste the XML that MUSHclient's Copy button puts on the clipboard" onClick={pasteXml}>Paste XML</button>
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
          <span className="muted small">{importMsg || (worldDirty ? 'Unsaved changes' : scriptDirty ? 'Script not saved (use Save script above)' : 'Saved')}</span>
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
          <ColourPicker value={t.highlight} onChange={(v) => patch({ highlight: v })} sample={t.highlight ? (t.regex ? 'Sample text' : t.pattern || 'Sample text') : undefined} />
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

/* ---------- channel tabs ---------- */

function ChannelsTab({ w, setW }: { w: World; setW: React.Dispatch<React.SetStateAction<World>> }) {
  const tabs = w.channelTabs;
  const [sel, setSel] = useState<string | null>(tabs[0]?.id ?? null);
  const selected = tabs.find((t) => t.id === sel) ?? null;
  const setTabs = (items: ChannelTab[]) => setW((x) => ({ ...x, channelTabs: items }));
  const patch = (p: Partial<ChannelTab>) => { if (selected) setTabs(tabs.map((t) => (t.id === selected.id ? { ...t, ...p } : t))); };

  const add = () => {
    const id = uid();
    setTabs([...tabs, normalizeChannelTab({ id, name: 'New tab', patterns: [{ id: uid(), pattern: '', ignoreCase: false, mode: 'capture' }] })]);
    setSel(id);
  };
  const addPreset = () => {
    const t = havenChannelTab(uid);
    setTabs([...tabs, t]);
    setSel(t.id);
  };
  const addHelpPreset = () => {
    const t = helpChannelTab(uid);
    setTabs([...tabs, t]);
    setSel(t.id);
  };
  const helpDone = hasHelpPreset(tabs);
  const duplicate = () => {
    if (!selected) return;
    const copy: ChannelTab = { ...selected, id: uid(), name: `${selected.name} (copy)`, patterns: selected.patterns.map((p) => ({ ...p, id: uid() })) };
    const i = tabs.findIndex((t) => t.id === selected.id);
    setTabs([...tabs.slice(0, i + 1), copy, ...tabs.slice(i + 1)]);
    setSel(copy.id);
  };
  const remove = () => {
    if (!selected) return;
    const i = tabs.findIndex((t) => t.id === selected.id);
    const next = tabs.filter((t) => t.id !== selected.id);
    setTabs(next);
    setSel(next[Math.min(i, next.length - 1)]?.id ?? null);
  };
  const move = (dir: -1 | 1) => {
    if (!selected) return;
    const i = tabs.findIndex((t) => t.id === selected.id);
    const j = i + dir;
    if (j < 0 || j >= tabs.length) return;
    const next = tabs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setTabs(next);
  };
  const havenDone = hasHavenPreset(tabs);

  return (
    <div className="auto-body">
      <div className="auto-side">
        <div className="auto-list">
          {tabs.length === 0 && (
            <div className="auto-empty-actions">
              <div className="muted small">No channel tabs yet. A channel tab collects matching lines (OOC chatter, guide channels…) in its own pane under the session tab, so the roleplay screen stays clean.</div>
              <button className="btn small primary" onClick={addPreset}>Add Haven channel tabs</button>
              <button className="btn small" onClick={addHelpPreset}>Add a Help tab</button>
            </div>
          )}
          {tabs.map((t) => (
            <div key={t.id} className={`auto-item ${t.id === sel ? 'selected' : ''} ${t.enabled ? '' : 'disabled'}`} onClick={() => setSel(t.id)}>
              <input type="checkbox" checked={t.enabled} title="Enabled" onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTabs(tabs.map((x) => (x.id === t.id ? { ...x, enabled: e.target.checked } : x)))} />
              <div className="auto-item-main">
                <div className="auto-item-title">{t.name || '(unnamed tab)'}</div>
                <div className="auto-item-sub muted">{channelSub(t)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="auto-list-actions">
          <button className="btn small" onClick={add}>+ New</button>
          <button className="btn small ghost" disabled={!selected} onClick={duplicate}>Duplicate</button>
          <span className="spacer" />
          <button className="icon-btn" title="Move up (tabs are tried in this order)" disabled={!selected} onClick={() => move(-1)}>↑</button>
          <button className="icon-btn" title="Move down" disabled={!selected} onClick={() => move(1)}>↓</button>
          <button className="btn small ghost danger" disabled={!selected} onClick={remove}>Delete</button>
        </div>
      </div>

      <div className="auto-editor">
        {!selected && tabs.length > 0 && <div className="muted pad">Select a tab on the left, or add a new one.</div>}
        {!selected && tabs.length === 0 && (
          <div className="muted pad small">
            The preset adds one tab, "{HAVEN_TAB_NAME}", capturing <span className="mono">[OOC]</span>, <span className="mono">[Guide]</span>, <span className="mono">[Newbie]</span> and <span className="mono">[HeyThere]</span> lines and silencing the bare <span className="mono">[AFK]</span> line Haven prints before each one while you are away.
          </div>
        )}
        {selected && <ChannelTabEditor t={selected} patch={patch} />}
        {tabs.length > 0 && (
          <div className="row">
            <button className="btn small ghost" disabled={havenDone} title={havenDone ? 'A tab with the Haven patterns already exists' : 'Add a tab with the Haven OOC / Guide / Newbie / HeyThere patterns'} onClick={addPreset}>
              {havenDone ? '✓ Haven channel tabs added' : 'Add Haven channel tabs'}
            </button>
            <button className="btn small ghost" disabled={helpDone} title={helpDone ? 'A Help tab already exists' : 'Add a tab that collects the replies to help, rules, news and similar commands'} onClick={addHelpPreset}>
              {helpDone ? '✓ Help tab added' : 'Add a Help tab'}
            </button>
          </div>
        )}
        <ChannelTest world={w} />
      </div>
    </div>
  );
}

function channelSub(t: ChannelTab): string {
  const live = t.patterns.filter((p) => p.pattern);
  const bits = [`${live.length} pattern${live.length === 1 ? '' : 's'}`];
  const silenced = live.filter((p) => p.mode === 'silence').length;
  if (silenced) bits.push(`${silenced} silenced`);
  if (t.keepInMain) bits.push('copy, main keeps them');
  if (t.commandPrefix) bits.push(`prefix "${t.commandPrefix}"`);
  if (t.notify !== 'badge') bits.push(t.notify === 'silent' ? 'no badge' : 'badge + sound');
  return bits.join(' · ');
}

function ChannelTabEditor({ t, patch }: { t: ChannelTab; patch(p: Partial<ChannelTab>): void }) {
  const setPattern = (id: string, p: Partial<ChannelPattern>) => patch({ patterns: t.patterns.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const addPattern = () => patch({ patterns: [...t.patterns, { id: uid(), pattern: '', ignoreCase: false, mode: 'capture' }] });
  const removePattern = (id: string) => patch({ patterns: t.patterns.filter((x) => x.id !== id) });
  return (
    <div className="auto-form">
      <div className="row">
        <Field label="Tab name" grow><input value={t.name} onChange={(e) => patch({ name: e.target.value })} placeholder="OOC channels" /></Field>
        <Field label="When a line arrives while you are elsewhere">
          <select value={t.notify} onChange={(e) => patch({ notify: e.target.value as ChannelNotify })}>
            <option value="badge">show a dot and count</option>
            <option value="badge+sound">dot, count and a quiet blip</option>
            <option value="silent">nothing</option>
          </select>
        </Field>
      </div>
      <div className="row wrap">
        <Check label="Keep a copy in Main" title="Otherwise matching lines move to this tab and leave the main pane" checked={t.keepInMain} onChange={(v) => patch({ keepInMain: v })} />
        <Check label="Trim blank lines around captured lines" title="Games often print an empty line before and after a channel message. When a message moves to this tab, its blank padding is removed from Main too." checked={t.trimBlanks} onChange={(v) => patch({ trimBlanks: v })} />
      </div>
      <Field label="Command prefix" hint={`Put in front of whatever you type while this tab is showing, so "hello" is sent as "${t.commandPrefix || 'ooc '}hello". Keep the trailing space if the game needs one. Start a command with ${PREFIX_BYPASS} to send it without the prefix once (${PREFIX_BYPASS}look sends "look"). Leave empty to type to the game as usual. Applied before aliases, stacking and speedwalk; ↑ recalls what you typed, not the prefixed command.`}>
        <input className="mono" style={{ width: 160 }} value={t.commandPrefix} onChange={(e) => patch({ commandPrefix: e.target.value })} placeholder="ooc " spellCheck={false} />
      </Field>
      <Field label="Space between messages (px)" hint="A gap after each message (paragraph spacing, not line height), so chat is easier to scan. Try 8. 0 = none.">
        <input type="number" min={0} max={40} step={1} style={{ width: 100 }} value={t.messageGap} onChange={(e) => patch({ messageGap: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} />
      </Field>
      <div className="row">
        <Field label="Capture replies to commands matching" grow hint={`A regular expression tested against each command you send. When it matches, the command and everything the game sends after it land in this tab until the output has been quiet for the time on the right, or you send another command. Lines a pattern tab claims still go there. Leave empty to capture by line patterns only. Example: ^help\\b`}>
          <input className="mono" value={t.captureCommands} onChange={(e) => patch({ captureCommands: e.target.value })} placeholder="^help\\b" spellCheck={false} />
        </Field>
        <Field label="Quiet for (ms)">
          <input type="number" min={200} max={10000} step={100} value={t.captureQuietMs} onChange={(e) => patch({ captureQuietMs: Number(e.target.value) || 1500 })} style={{ width: 100 }} />
        </Field>
      </div>
      <Field label="Patterns" hint="JavaScript regular expressions, tested against the plain text of each finished line after triggers have run. Tabs are tried top to bottom, patterns top to bottom; the first match wins. Capture sends the line to this tab; silence drops it everywhere (noise such as a bare [AFK] line).">
        <div className="chan-patterns">
          {t.patterns.map((p) => {
            const err = channelPatternError(p.pattern);
            return (
              <div key={p.id} className="chan-pattern" title={err ?? ''}>
                <input className={`mono ${err && p.pattern ? 'invalid' : ''}`} value={p.pattern} onChange={(e) => setPattern(p.id, { pattern: e.target.value })} placeholder="^\[OOC\] " spellCheck={false} />
                <Check label="Ignore case" checked={p.ignoreCase} onChange={(v) => setPattern(p.id, { ignoreCase: v })} />
                <select value={p.mode} onChange={(e) => setPattern(p.id, { mode: e.target.value as ChannelMode })}>
                  <option value="capture">capture</option>
                  <option value="silence">silence</option>
                </select>
                <button type="button" className="icon-btn" title="Remove this pattern" onClick={() => removePattern(p.id)}>×</button>
              </div>
            );
          })}
          <button type="button" className="btn small ghost self-start" onClick={addPattern}>+ Add pattern</button>
        </div>
      </Field>
    </div>
  );
}

function ChannelTest({ world }: { world: World }) {
  const [text, setText] = useState('');
  const lines = text.split('\n').filter((l) => l.length > 0);
  return (
    <div className="auto-test">
      <div className="auto-test-head">
        <span>Try it</span>
        <span className="muted small">Paste a line or two of game output to see which tab each would land in.</span>
      </div>
      <textarea className="mono" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="[OOC] Someone says, &quot;anyone around?&quot;" spellCheck={false} />
      {lines.map((line, i) => {
        const c = classifyLine(world.triggers, world.channelTabs, line);
        const r = c.route;
        return (
          <div key={i} className="auto-test-result">
            <div className={`mono preview ${!r || r.action === 'silence' ? 'gagged' : ''}`}>{line}</div>
            <div className="small">
              {!r && <><span className="route-tag gag">gagged</span>Hidden by trigger {c.triggers.fired.filter((t) => t.gag).map((t) => t.name || t.pattern).join(', ')}; never reaches a tab.</>}
              {r && r.action === 'main' && <><span className="route-tag">Main</span>No channel pattern matches; stays in the main pane.</>}
              {r && r.action === 'silence' && r.tab && <><span className="route-tag silence">silenced</span>Dropped by "{r.tab.name}" ({r.pattern?.pattern}); shown nowhere.</>}
              {r && r.action === 'capture' && r.tab && <><span className="route-tag capture">{r.tab.name}</span>{r.showInMain ? 'Copied to the tab; Main keeps it.' : 'Moves to the tab; leaves Main.'} <span className="muted mono">{r.pattern?.pattern}</span></>}
            </div>
          </div>
        );
      })}
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
