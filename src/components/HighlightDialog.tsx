/**
 * Quick "Highlight word or phrase" (Ctrl+Alt+H), in the spirit of MUSHclient's.
 * Produces an ordinary colour-only trigger in the "Highlights" group, so it can
 * be edited or removed later from the Automation panel.
 */
import { useEffect, useRef, useState } from 'react';
import type { Trigger } from '../../shared/types';
import { ColourPicker } from './ColourPicker';

interface Props {
  worldName: string;
  initialText?: string;
  onSave(t: Trigger): void;
  onClose(): void;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildHighlightTrigger(text: string, colour: string, wholeWord: boolean, matchCase: boolean, wholeLine: boolean): Trigger {
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
    oneShot: false,
  };
}

export function HighlightDialog({ worldName, initialText = '', onSave, onClose }: Props) {
  const [text, setText] = useState(initialText);
  const [colour, setColour] = useState<string | null>('11');
  const [wholeWord, setWholeWord] = useState(true);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeLine, setWholeLine] = useState(false);
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
      <form className="modal narrow" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(buildHighlightTrigger(text, colour!, wholeWord, matchCase, wholeLine)); }}>
        <h2>Highlight word or phrase</h2>
        <p className="muted small">Adds a colour trigger to {worldName}. Edit or remove it later under ⚡ Automation › Triggers, group "Highlights".</p>
        <label>Highlight
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="a name, a word, a phrase" />
        </label>
        <label>Colour
          <ColourPicker value={colour} onChange={setColour} allowNone={false} sample={text.trim() || 'Sample text'} />
        </label>
        <div className="row wrap">
          <label className="check inline"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word only</label>
          <label className="check inline"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
          <label className="check inline"><input type="checkbox" checked={wholeLine} onChange={(e) => setWholeLine(e.target.checked)} /> Colour the whole line</label>
        </div>
        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid}>Add highlight</button>
        </div>
      </form>
    </div>
  );
}
