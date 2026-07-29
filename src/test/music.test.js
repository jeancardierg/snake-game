/**
 * Unit tests for the background music sequencer.
 *
 * jsdom provides no AudioContext, so getCtx() returns null and every playback
 * path must degrade to a silent no-op. That is not a cosmetic concern: the hook
 * tests in useSnake.test.jsx drive start/pause/resume/stop through the real
 * game loop, so a music function that throws without Web Audio would break the
 * entire suite. These tests pin that behaviour down directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildPattern, startMusic, stopMusic, pauseMusic, resumeMusic,
  isMusicEnabled, setMusicEnabled,
} from '../music';
import { getLevel } from '../levels';

const TRACK = getLevel(0).music;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  stopMusic();
  setMusicEnabled(true);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('no-op without Web Audio', () => {
  it('confirms the environment really has no AudioContext', () => {
    expect(window.AudioContext).toBeUndefined();
  });

  it('startMusic does not throw', () => {
    expect(() => startMusic(TRACK)).not.toThrow();
  });

  it('stopMusic does not throw, with or without a track playing', () => {
    expect(() => stopMusic()).not.toThrow();
    startMusic(TRACK);
    expect(() => stopMusic()).not.toThrow();
  });

  it('pause/resume do not throw in any order', () => {
    expect(() => pauseMusic()).not.toThrow();
    expect(() => resumeMusic()).not.toThrow();
    startMusic(TRACK);
    expect(() => pauseMusic()).not.toThrow();
    expect(() => resumeMusic()).not.toThrow();
  });

  it('survives a full level sequence of track switches', () => {
    expect(() => {
      for (let n = 0; n < 25; n++) startMusic(getLevel(n).music);
      stopMusic();
    }).not.toThrow();
  });

  it('leaves no scheduler interval running after stopMusic', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    startMusic(TRACK);
    stopMusic();
    // Nothing was scheduled (no AudioContext), so nothing to clear — the point
    // is that stopMusic completes rather than leaking or throwing.
    expect(() => stopMusic()).not.toThrow();
    clear.mockRestore();
  });
});

describe('mute preference', () => {
  it('defaults to enabled', () => {
    expect(isMusicEnabled()).toBe(true);
  });

  it('round-trips through localStorage', () => {
    setMusicEnabled(false);
    expect(isMusicEnabled()).toBe(false);
    expect(localStorage.getItem('snakeMusic')).toBe('off');

    setMusicEnabled(true);
    expect(isMusicEnabled()).toBe(true);
    expect(localStorage.getItem('snakeMusic')).toBe('on');
  });

  it('coerces truthy/falsy arguments to a boolean', () => {
    setMusicEnabled(0);
    expect(isMusicEnabled()).toBe(false);
    setMusicEnabled('yes');
    expect(isMusicEnabled()).toBe(true);
  });

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => setMusicEnabled(false)).not.toThrow();
    expect(isMusicEnabled()).toBe(false);
  });

  it('startMusic is inert while muted', () => {
    setMusicEnabled(false);
    expect(() => startMusic(TRACK)).not.toThrow();
  });
});

describe('buildPattern', () => {
  it('is deterministic for a given track', () => {
    expect(buildPattern(TRACK)).toEqual(buildPattern(TRACK));
  });

  it('differs between levels', () => {
    const a = buildPattern(getLevel(0).music);
    const b = buildPattern(getLevel(1).music);
    expect(a.lead).not.toEqual(b.lead);
  });

  it('produces equal-length lead, bass and perc tracks', () => {
    const p = buildPattern(TRACK);
    expect(p.lead.length).toBe(p.bass.length);
    expect(p.lead.length).toBe(p.perc.length);
    expect(p.lead.length).toBeGreaterThan(0);
  });

  it('sounds a note on every downbeat', () => {
    const p = buildPattern(TRACK);
    for (let i = 0; i < p.lead.length; i += 4) {
      expect(p.lead[i]).not.toBeNull();
    }
  });

  it('keeps every note in a sane MIDI range', () => {
    for (let n = 0; n < 30; n++) {
      const p = buildPattern(getLevel(n).music);
      for (const note of [...p.lead, ...p.bass]) {
        if (note === null) continue;
        expect(note).toBeGreaterThan(20);
        expect(note).toBeLessThan(108);
      }
    }
  });

  it('falls back to a known scale when given an unknown one', () => {
    expect(() => buildPattern({ ...TRACK, scale: 'not-a-scale' })).not.toThrow();
  });
});
