/** Play the built-in trigger alert tones (shared/sounds.ts) through the Web Audio API. */
import { soundDef, type SoundDef } from '../../shared/sounds';

let ctx: AudioContext | null = null;
let volume = 0.6; // 0..1, from the Alert volume setting; scales the peak gain below

/** Set the alert volume (0..1). Used by the store's channel blip too, so one knob covers both. */
export function setSoundVolume(v: number) { volume = Math.max(0, Math.min(1, v)); }
export function soundVolume() { return volume; }

function play(def: SoundDef, vol: number) {
  if (typeof AudioContext === 'undefined' || vol <= 0) return;
  const peak = 0.55 * vol; // full volume is loud but short; the old fixed level was ~0.09 (too quiet)
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
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + step.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + step.dur + 0.02);
      }
      t += step.dur;
    }
  } catch { /* no audio device, or autoplay blocked */ }
}

/** Play a built-in sound by id; unknown or null ids are ignored. `vol` overrides the set volume (for a preview). */
export function playSound(id: string | null | undefined, vol?: number) {
  const def = soundDef(id);
  if (def) play(def, vol ?? volume);
}
