/**
 * Quick "Highlight word or phrase" (Ctrl+Alt+H), in the spirit of MUSHclient's.
 * Produces an ordinary colour-only trigger in the "Highlights" group, so it can
 * be edited or removed later from the Automation panel.
 */
import { useEffect, useRef, useState } from 'react';
import type { Trigger } from '../../shared/types';
import type { CustomColour } from '../lib/settings';
import { ColourPicker } from './ColourPicker';
import { TRIGGER_SOUNDS } from '../../shared/sounds';
import { playSound } from '../lib/sound';

interface Props {
  worldName: string;
  initialText?: string;
  /** Saved colours from Settings › Colours, offered as one-click chips; a highlight linked to one follows later edits to it. */
  customColours?: CustomColour[];
  onSave(t: Trigger): void;
  onClose(): void;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildHighlightTrigger(text: string, colour: string, wholeWord: boolean, matchCase: boolean, wholeLine: boolean, sound: string | null = null): Trigger {
  const core = escapeRegex(text.trim());
  const lead = wholeWord && /^\w/.test(text.trim()) ? '\\b' : '';
  const tail = wholeWord && /\w$/.test(text.trim()) ? '\\b' : '';
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    name: `Highlight: ${text.trim()}`,
    pattern: `${lead}${core}${tail}`,
    regex: true,
    enabled: true,
    group: 'Highlights',
    ignoreCase: !matchCase,
    send: '',
    sendTo: 'world',
    highlight: colour,
    highlightBg: null,
    highlightLine: wholeLine,
    gag: false,
    sound,
    oneShot: false,
  };
}

export function HighlightDialog({ worldName, initialText = '', customColours = [], onSave, onClose }: Props) {
  const [text, setText] = useState(initialText);
  const [colour, setColour] = useState<string | null>('11');
  // A chip sets the colour to "custom:<id>", the same reference a trigger stores, so the highlight follows the saved colour.
  const customRef = colour && colour.startsWith('custom:') ? customColours.find((c) => `custom:${c.id}` === colour) ?? null : null;
  const [wholeWord, setWholeWord] = useState(true);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeLine, setWholeLine] = useState(false);
  const [sound, setSound] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const valid = text.trim().length > 0 && colour !== null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal narrow" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(buildHighlightTrigger(text, colour!, wholeWord, matchCase, wholeLine, sound)); }}>
        <button type="button" className="modal-x" title="Close" onClick={onClose}>×</button>
        <h2>Highlight word or phrase</h2>
        <p className="muted small">Adds a colour trigger to {worldName}. Edit or remove it later under ⚡ Automation › Triggers, group "Highlights".</p>
        <label>Highlight
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="a name, a word, a phrase" />
        </label>
        {customRef ? (
          <label>Colour
            <div className="customcol-linked">
              Linked to custom colour <b style={{ color: customRef.fg, background: customRef.bg || 'transparent', padding: '0 4px', borderRadius: 4 }}>{customRef.name}</b>:
              <span style={{ color: customRef.fg, background: customRef.bg || 'transparent', padding: '0 4px', borderRadius: 4, marginLeft: 6 }}>{text.trim() || 'Sample text'}</span>
              <button type="button" className="btn small ghost" onClick={() => setColour(customRef.fg)}>Pick a fixed colour instead</button>
            </div>
          </label>
        ) : (
          <label>Colour
            <ColourPicker value={colour} onChange={setColour} allowNone={false} sample={text.trim() || 'Sample text'} />
          </label>
        )}
        {customColours.length > 0 && (
          <label>Custom colours
            <div className="customcol-row">
              {customColours.map((c) => {
                const active = colour === `custom:${c.id}`;
                return (
                  <button type="button" key={c.id} className={`customcol ${active ? 'active' : ''}`} title={`${c.name}: a highlight linked to this colour follows it when you edit it in Settings › Colours`}
                    style={{ color: c.fg, background: c.bg || 'transparent', borderColor: active ? 'var(--accent)' : (c.bg || c.fg) }}
                    onClick={() => setColour(`custom:${c.id}`)}>
                    {c.name}
                  </button>
                );
              })}
            </div>
          </label>
        )}
        <div className="row wrap">
          <label className="check inline"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word only</label>
          <label className="check inline"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
          <label className="check inline"><input type="checkbox" checked={wholeLine} onChange={(e) => setWholeLine(e.target.checked)} /> Colour the whole line</label>
        </div>
        <label>Sound when it appears
          <div className="row">
            <select className="grow" value={sound ?? ''} onChange={(e) => setSound(e.target.value || null)}>
              <option value="">No sound</option>
              {TRIGGER_SOUNDS.map((sd) => <option key={sd.id} value={sd.id}>{sd.name}</option>)}
            </select>
            <button type="button" className="btn small ghost" disabled={!sound} onClick={() => playSound(sound)}>▶ Play</button>
          </div>
        </label>
        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid}>Add highlight</button>
        </div>
      </form>
    </div>
  );
}
