/**
 * Built-in alert sounds a trigger can play when it fires (e.g. when your name is mentioned).
 * Just short tone sequences, so there are no audio files to ship. A step with freq 0 is a rest.
 */
export interface SoundStep { freq: number; dur: number }
export interface SoundDef { id: string; name: string; steps: SoundStep[] }

export const TRIGGER_SOUNDS: SoundDef[] = [
  { id: 'beep',  name: 'Beep',   steps: [{ freq: 880, dur: 0.18 }] },
  { id: 'chime', name: 'Chime',  steps: [{ freq: 660, dur: 0.12 }, { freq: 988, dur: 0.2 }] },
  { id: 'alert', name: 'Alert',  steps: [{ freq: 880, dur: 0.09 }, { freq: 0, dur: 0.05 }, { freq: 880, dur: 0.09 }, { freq: 0, dur: 0.05 }, { freq: 880, dur: 0.12 }] },
  { id: 'knock', name: 'Knock',  steps: [{ freq: 300, dur: 0.07 }, { freq: 0, dur: 0.07 }, { freq: 300, dur: 0.07 }] },
  { id: 'low',   name: 'Low',    steps: [{ freq: 392, dur: 0.24 }] },
];

export function soundDef(id: string | null | undefined): SoundDef | null {
  return id ? TRIGGER_SOUNDS.find((s) => s.id === id) ?? null : null;
}
