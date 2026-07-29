/**
 * Unit tests for the level generator.
 *
 * The generator is the only part of the game whose output nothing else
 * validates at runtime, so the invariants it promises are asserted here over a
 * range far beyond anything a player will reach.
 *
 * The most important of these is reachability: an unreachable pocket lets
 * randomFood spawn food the player can never eat, which soft-locks the level
 * with no visible error.
 */
import { describe, it, expect } from 'vitest';
import { COLS, ROWS, MAX_OBSTACLES } from '../constants';
import {
  getLevel, mulberry32, isReachable, generateObstacles,
  foodsForLevel, scoreNextFor, SPAWN_ROW, SPAWN_RUNWAY_X,
} from '../levels';

const RANGE = 200;

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('getLevel', () => {
  it('is deterministic — repeated calls return identical obstacle layouts', () => {
    for (let n = 0; n <= RANGE; n += 7) {
      expect(getLevel(n).obstacles).toEqual(getLevel(n).obstacles);
    }
  });

  it('coerces junk indices to level 0 rather than throwing', () => {
    for (const bad of [undefined, null, NaN, -1, -99, Infinity, 'x']) {
      expect(getLevel(bad).index).toBe(0);
    }
  });

  it('floors fractional indices', () => {
    expect(getLevel(3.7).index).toBe(3);
  });

  it('gives every level a unique, stable identifier and title', () => {
    const ids    = new Set();
    const titles = new Set();
    for (let n = 0; n <= RANGE; n++) {
      const { id, title } = getLevel(n);
      expect(id).toMatch(/^L\d{2,}$/);
      expect(title).toContain(id.slice(1));
      ids.add(id);
      titles.add(title);
    }
    expect(ids.size).toBe(RANGE + 1);
    expect(titles.size).toBe(RANGE + 1);
  });

  it('keeps the original tier names for the first five levels', () => {
    expect(getLevel(0).label).toBe('EASY');
    expect(getLevel(1).label).toBe('MEDIUM');
    expect(getLevel(2).label).toBe('FAST');
    expect(getLevel(3).label).toBe('HYPER');
    expect(getLevel(4).label).toBe('INSANE');
  });

  it('emits a CSS accent color and a full three.js theme for every level', () => {
    for (let n = 0; n <= RANGE; n += 3) {
      const lvl = getLevel(n);
      expect(lvl.color).toMatch(/^#[0-9a-f]{6}$/i);
      for (const k of ['bg', 'ground', 'grid', 'obstacle', 'ambient', 'sun', 'fill', 'food']) {
        expect(Number.isInteger(lvl.theme[k])).toBe(true);
        expect(lvl.theme[k]).toBeGreaterThanOrEqual(0);
        expect(lvl.theme[k]).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('emits a playable music descriptor for every level', () => {
    for (let n = 0; n <= RANGE; n += 3) {
      const { music } = getLevel(n);
      expect(typeof music.root).toBe('number');
      expect(typeof music.scale).toBe('string');
      expect(music.bpm).toBeGreaterThan(0);
      expect(music.bpm).toBeLessThanOrEqual(180);
      expect(music.seed).toBe(n);
    }
  });
});

describe('difficulty curve', () => {
  it('foods per level never decreases and plateaus', () => {
    for (let n = 1; n <= RANGE; n++) {
      expect(foodsForLevel(n)).toBeGreaterThanOrEqual(foodsForLevel(n - 1));
    }
  });

  it('score thresholds are strictly increasing across the whole range', () => {
    for (let n = 1; n <= RANGE; n++) {
      expect(scoreNextFor(n)).toBeGreaterThan(scoreNextFor(n - 1));
    }
  });

  it('a threshold equals the previous one plus the level food quota × 10', () => {
    for (let n = 1; n <= 20; n++) {
      expect(scoreNextFor(n) - scoreNextFor(n - 1)).toBe(foodsForLevel(n) * 10);
    }
  });
});

describe('obstacle layouts', () => {
  it('never exceed MAX_OBSTACLES', () => {
    for (let n = 0; n <= RANGE; n++) {
      expect(getLevel(n).obstacles.length).toBeLessThanOrEqual(MAX_OBSTACLES);
    }
  });

  it('stay inside the board', () => {
    for (let n = 0; n <= RANGE; n++) {
      for (const { x, y } of getLevel(n).obstacles) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(COLS);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(ROWS);
      }
    }
  });

  it('contain no duplicate cells', () => {
    for (let n = 0; n <= RANGE; n++) {
      const cells = getLevel(n).obstacles;
      expect(new Set(cells.map(c => `${c.x},${c.y}`)).size).toBe(cells.length);
    }
  });

  it('never block the spawn row or the runway ahead of the head', () => {
    for (let n = 0; n <= RANGE; n++) {
      for (const { x, y } of getLevel(n).obstacles) {
        expect(y === SPAWN_ROW && x <= SPAWN_RUNWAY_X).toBe(false);
      }
    }
  });

  it('leave every free cell reachable from the spawn head', () => {
    for (let n = 0; n <= RANGE; n++) {
      expect(isReachable(getLevel(n).obstacles)).toBe(true);
    }
  });

  it('are empty on the opening levels', () => {
    expect(getLevel(0).obstacles).toEqual([]);
  });

  it('actually place obstacles once the game gets going', () => {
    const withWalls = [];
    for (let n = 0; n <= 40; n++) {
      if (getLevel(n).obstacles.length > 0) withWalls.push(n);
    }
    expect(withWalls.length).toBeGreaterThan(20);
  });
});

describe('isReachable', () => {
  it('accepts an empty board', () => {
    expect(isReachable([])).toBe(true);
  });

  it('rejects a layout that walls off a corner', () => {
    // Seal (0,0) behind a two-cell diagonal barrier
    expect(isReachable([{ x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false);
  });

  it('accepts a barrier that leaves a way around', () => {
    expect(isReachable([{ x: 1, y: 0 }])).toBe(true);
  });
});

describe('generateObstacles', () => {
  it('returns an empty layout for level 0 regardless of the rng', () => {
    expect(generateObstacles(0, mulberry32(1))).toEqual([]);
  });

  it('returns a reachable layout for every seed it is given', () => {
    for (let seed = 0; seed < 60; seed++) {
      expect(isReachable(generateObstacles(20, mulberry32(seed)))).toBe(true);
    }
  });
});
