/**
 * music.js — looping 8-bit background music, synthesized at runtime.
 *
 * No audio files: the CSP in index.html is `default-src 'self'` with no
 * media-src, so data:/blob: audio and any CDN are blocked. Pure Web Audio
 * synthesis sidesteps the policy entirely — the same approach audio.js takes
 * for sound effects, and the same AudioContext is reused.
 *
 * Each level supplies a small track descriptor (root note, scale, waveform,
 * bpm, seed); the two-bar pattern is generated deterministically from it, so a
 * given level always sounds the same but different levels do not.
 *
 * Scheduling uses the standard Web Audio lookahead pattern: a coarse
 * setInterval wakes up often enough to queue every note that falls inside the
 * next SCHEDULE_AHEAD seconds, with each note's start time expressed against
 * ctx.currentTime. Scheduling notes with setTimeout directly would drift
 * audibly within a few bars.
 *
 * Every entry point is a no-op when getCtx() returns null (jsdom under test,
 * or a browser without Web Audio).
 */
import { getCtx } from './audio';
import { mulberry32 } from './levels';

// ─── Musical data ─────────────────────────────────────────────────────────────

const SCALES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
};

const STEPS = 32;          // 16th notes per loop — two bars of 4/4
const MUSIC_VOLUME = 0.16; // master music level; SFX sit on top of this

/** MIDI note number → frequency in Hz. */
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * Build a deterministic two-bar pattern from a track descriptor.
 *
 * lead: sparse melody that walks the scale, biased toward stepwise motion.
 * bass: root on the downbeats, fifth on the "and" of beats 2 and 4.
 * perc: noise blip on the backbeat.
 */
export function buildPattern(track) {
  const scale = SCALES[track.scale] ?? SCALES.minor;
  const rng   = mulberry32((track.seed ?? 0) * 0x85ebca6b + 0x27d4eb2d);

  const lead = new Array(STEPS).fill(null);
  let degree = 0;
  for (let i = 0; i < STEPS; i++) {
    // Downbeats always sound; off-beats are sparse so the line breathes.
    const onBeat = i % 4 === 0;
    if (!onBeat && rng() > 0.38) continue;

    // Mostly stepwise motion, occasional leap — reads as a melody, not noise.
    degree += rng() < 0.75 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.5 ? -2 : 3);
    degree = Math.max(-3, Math.min(scale.length + 3, degree));

    const octave = Math.floor(degree / scale.length);
    const idx    = ((degree % scale.length) + scale.length) % scale.length;
    lead[i] = track.root + 12 + scale[idx] + octave * 12;
  }

  const bass = new Array(STEPS).fill(null);
  for (let i = 0; i < STEPS; i += 8) bass[i] = track.root - 12;
  for (let i = 6; i < STEPS; i += 8) bass[i] = track.root - 12 + scale[Math.min(4, scale.length - 1)];

  const perc = new Array(STEPS).fill(false);
  for (let i = 4; i < STEPS; i += 8) perc[i] = true;

  return { lead, bass, perc, wave: track.wave ?? 'square', bpm: track.bpm ?? 100 };
}

// ─── Playback state ───────────────────────────────────────────────────────────

let timer        = null;   // lookahead scheduler interval
let musicGain    = null;   // master gain for all music voices
let noiseBuffer  = null;   // shared white-noise buffer for percussion
let pattern      = null;   // current compiled pattern
let currentTrack = null;   // descriptor of the track in play (for resume/unmute)
let step         = 0;      // next step index to schedule
let nextNoteTime = 0;      // AudioContext time of that step

const LOOKAHEAD_MS   = 25;    // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.15;  // seconds of notes queued ahead of the clock

// ─── Mute preference ──────────────────────────────────────────────────────────

let enabled = true;

function readEnabled() {
  try {
    return localStorage.getItem('snakeMusic') !== 'off';
  } catch (e) {
    console.warn('[music] localStorage unavailable:', e.message);
    return true;
  }
}
enabled = readEnabled();

export function isMusicEnabled() {
  return enabled;
}

/** Toggle music. Stops immediately when disabled; restarts the current track when re-enabled. */
export function setMusicEnabled(next) {
  enabled = !!next;
  try {
    localStorage.setItem('snakeMusic', enabled ? 'on' : 'off');
  } catch (e) {
    console.warn('[music] localStorage write failed:', e.message);
  }
  if (!enabled) {
    stopMusic({ keepTrack: true });
  } else if (currentTrack) {
    startMusic(currentTrack);
  }
}

// ─── Voices ───────────────────────────────────────────────────────────────────

function getNoiseBuffer(ac) {
  if (noiseBuffer) return noiseBuffer;
  const frames = Math.floor(ac.sampleRate * 0.2);
  noiseBuffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function voice(ac, freq, at, duration, wave, volume) {
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  // Tiny attack ramp: stepping the gain instantly produces an audible click,
  // which is very noticeable at 16th-note density.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain);
  gain.connect(musicGain);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

function blip(ac, at) {
  const src  = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = getNoiseBuffer(ac);
  gain.gain.setValueAtTime(0.09, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
  src.connect(gain);
  gain.connect(musicGain);
  src.start(at);
  src.stop(at + 0.08);
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

function scheduleStep(ac, i, at, stepDur) {
  const n = pattern.lead[i];
  if (n !== null) voice(ac, midiToFreq(n), at, stepDur * 1.6, pattern.wave, 0.11);

  const b = pattern.bass[i];
  if (b !== null) voice(ac, midiToFreq(b), at, stepDur * 3.2, 'triangle', 0.20);

  if (pattern.perc[i]) blip(ac, at);
}

function scheduler() {
  const ac = getCtx();
  if (!ac || !pattern) return;

  const stepDur = 60 / pattern.bpm / 4;   // one 16th note in seconds
  while (nextNoteTime < ac.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(ac, step, nextNoteTime, stepDur);
    nextNoteTime += stepDur;
    step = (step + 1) % STEPS;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start (or switch to) a level's track. Restarts the loop from step 0.
 * Remembers the descriptor so unmuting and resuming can pick it back up.
 */
export function startMusic(track) {
  currentTrack = track ?? currentTrack;
  if (!enabled || !currentTrack) return;

  const ac = getCtx();
  if (!ac) return;

  stopMusic({ keepTrack: true });

  if (!musicGain) {
    musicGain = ac.createGain();
    musicGain.connect(ac.destination);
  }
  // stopMusic() above scheduled a fade-out ramp. Cancel it before setting the
  // level, or that pending ramp would still fire and silence the new track.
  musicGain.gain.cancelScheduledValues(ac.currentTime);
  musicGain.gain.setValueAtTime(MUSIC_VOLUME, ac.currentTime);

  pattern      = buildPattern(currentTrack);
  step         = 0;
  nextNoteTime = ac.currentTime + 0.06;   // small head start for the first batch
  timer        = setInterval(scheduler, LOOKAHEAD_MS);
}

/**
 * Stop the loop and silence any notes already queued.
 *
 * Voices scheduled up to SCHEDULE_AHEAD in the future are already committed to
 * the audio graph, so clearing the interval alone would leave a tail playing —
 * the gain ramp below is what actually cuts them.
 */
export function stopMusic({ keepTrack = false } = {}) {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  pattern = null;
  if (!keepTrack) currentTrack = null;

  // Guard on musicGain first, not on getCtx(): musicGain only exists once
  // startMusic has run inside a user gesture. Calling getCtx() unconditionally
  // would construct an AudioContext on paths that run before any gesture —
  // React's StrictMode remount invokes the unmount cleanup, which calls this —
  // and Chrome logs an autoplay-policy warning for that.
  if (musicGain) {
    const ac = getCtx();
    if (ac) {
      musicGain.gain.cancelScheduledValues(ac.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ac.currentTime);
      musicGain.gain.linearRampToValueAtTime(0.0001, ac.currentTime + 0.08);
    }
  }
}

/** Suspend playback, keeping the current track for resumeMusic(). */
export function pauseMusic() {
  if (timer === null) return;
  stopMusic({ keepTrack: true });
}

/** Resume the track suspended by pauseMusic(). No-op if nothing was playing. */
export function resumeMusic() {
  if (!currentTrack || timer !== null) return;
  startMusic(currentTrack);
}
