/**
 * Built-in alert sounds a trigger can play when it fires (e.g. when your name is mentioned).
 * Just short tone sequences, so there are no audio files to ship. A step with freq 0 is a rest.
 */
export interface SoundStep { freq: number; dur: number }
export interface SoundDef { id: string; name: string; steps: SoundStep[] }

export const TRIGGER_SOUNDS: SoundDef[] = [
  { id: 'beep',   name: 'Beep',      steps: [{ freq: 880, dur: 0.18 }] },
  { id: 'chime',  name: 'Chime',     steps: [{ freq: 660, dur: 0.12 }, { freq: 988, dur: 0.2 }] },
  { id: 'alert',  name: 'Alert',     steps: [{ freq: 880, dur: 0.09 }, { freq: 0, dur: 0.05 }, { freq: 880, dur: 0.09 }, { freq: 0, dur: 0.05 }, { freq: 880, dur: 0.12 }] },
  { id: 'knock',  name: 'Knock',     steps: [{ freq: 300, dur: 0.07 }, { freq: 0, dur: 0.07 }, { freq: 300, dur: 0.07 }] },
  { id: 'low',    name: 'Low',       steps: [{ freq: 392, dur: 0.24 }] },
  { id: 'rise',   name: 'Rise',      steps: [{ freq: 523, dur: 0.1 }, { freq: 659, dur: 0.1 }, { freq: 784, dur: 0.18 }] },
  { id: 'fall',   name: 'Fall',      steps: [{ freq: 784, dur: 0.1 }, { freq: 659, dur: 0.1 }, { freq: 523, dur: 0.18 }] },
  { id: 'ding',   name: 'Ding-dong', steps: [{ freq: 659, dur: 0.18 }, { freq: 523, dur: 0.34 }] },
  { id: 'trill',  name: 'Trill',     steps: [{ freq: 880, dur: 0.06 }, { freq: 988, dur: 0.06 }, { freq: 880, dur: 0.06 }, { freq: 988, dur: 0.14 }] },
  { id: 'ping',   name: 'Ping',      steps: [{ freq: 1320, dur: 0.12 }] },
  { id: 'coin',   name: 'Coin',      steps: [{ freq: 988, dur: 0.06 }, { freq: 1319, dur: 0.16 }] },
  { id: 'warble', name: 'Warble',    steps: [{ freq: 700, dur: 0.08 }, { freq: 1000, dur: 0.08 }, { freq: 700, dur: 0.14 }] },
  { id: 'pulse',  name: 'Pulse',     steps: [{ freq: 740, dur: 0.08 }, { freq: 0, dur: 0.07 }, { freq: 740, dur: 0.08 }, { freq: 0, dur: 0.07 }, { freq: 740, dur: 0.08 }] },
  { id: 'sonar',  name: 'Sonar',     steps: [{ freq: 1200, dur: 0.05 }, { freq: 0, dur: 0.02 }, { freq: 600, dur: 0.3 }] },
  { id: 'tri',    name: 'Three bells', steps: [{ freq: 784, dur: 0.1 }, { freq: 0, dur: 0.06 }, { freq: 784, dur: 0.1 }, { freq: 0, dur: 0.06 }, { freq: 784, dur: 0.16 }] },
];

export function soundDef(id: string | null | undefined): SoundDef | null {
  return id ? TRIGGER_SOUNDS.find((s) => s.id === id) ?? null : null;
}
