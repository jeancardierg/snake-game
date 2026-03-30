/**
 * audio.js — 8-bit style sound effects using Web Audio API.
 *
 * All sounds are synthesized at runtime using OscillatorNode with
 * square/sawtooth waveforms for a retro 8-bit feel.
 *
 * AudioContext is created lazily on first call (browser autoplay
 * policy requires creation during a user gesture).
 */

let ctx = null;

function getCtx() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function playTone(freq, duration, type = 'square', volume = 0.15, delay = 0) {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Game start: ascending C5→E5→G5 arpeggio */
export function playStart() {
  playTone(523, 0.10, 'square', 0.12, 0);
  playTone(659, 0.10, 'square', 0.12, 0.08);
  playTone(784, 0.15, 'square', 0.14, 0.16);
}

/** Food eaten: short chirp A5→C6 */
export function playEat() {
  playTone(880, 0.06, 'square', 0.10, 0);
  playTone(1047, 0.08, 'square', 0.12, 0.05);
}

/** Level up: 4-note ascending fanfare */
export function playLevelUp() {
  playTone(523, 0.08, 'sawtooth', 0.10, 0);
  playTone(659, 0.08, 'sawtooth', 0.10, 0.08);
  playTone(784, 0.08, 'sawtooth', 0.10, 0.16);
  playTone(1047, 0.20, 'sawtooth', 0.14, 0.24);
}

/** Death: descending C5→C3 slide */
export function playDeath() {
  const ac = getCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(523, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(131, ac.currentTime + 0.5);
  gain.gain.setValueAtTime(0.15, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.65);
}
