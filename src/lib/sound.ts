/** Play the built-in trigger alert tones (shared/sounds.ts) through the Web Audio API. */
import { soundDef, type SoundDef } from '../../shared/sounds';

let ctx: AudioContext | null = null;

function play(def: SoundDef) {
  if (typeof AudioContext === 'undefined') return;
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const step of def.steps) {
      if (step.freq > 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = step.freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + step.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + step.dur + 0.02);
      }
      t += step.dur;
    }
  } catch { /* no audio device, or autoplay blocked */ }
}

/** Play a built-in sound by id; unknown or null ids are ignored. */
export function playSound(id: string | null | undefined) {
  const def = soundDef(id);
  if (def) play(def);
}
