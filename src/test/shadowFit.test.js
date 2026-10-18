/**
 * Shadow box sizing. Regression: the box was sized from the board half-width
 * (±150 on 13×13), but the shadow camera is tilted with the light, so the board
 * corners fell outside it and shadows were cut diagonally at all four corners.
 */
import { describe, it, expect } from 'vitest';
import { shadowHalfExtent } from '../shadowFit';
import { COLS, CELL } from '../constants';

const HALF = (COLS * CELL) / 2;
const SUN = { x: -80, y: 180, z: -60 };   // GameCanvas sun position

/** Max perpendicular distance from the light axis of the 8 board-volume corners. */
function cornerReach(half, height, L) {
  const len = Math.hypot(L.x, L.y, L.z); const u = { x: -L.x / len, y: -L.y / len, z: -L.z / len };
  let m = 0;
  for (const x of [-half, half]) for (const y of [0, height]) for (const z of [-half, half]) {
    const d = x * u.x + y * u.y + z * u.z; m = Math.max(m, Math.hypot(x - d * u.x, y - d * u.y, z - d * u.z));
  }
  return m;
}

describe('shadowHalfExtent', () => {
  it('covers every board corner as seen from the light', () => {
    expect(shadowHalfExtent(HALF, CELL, SUN)).toBeGreaterThanOrEqual(cornerReach(HALF, CELL, SUN));
  });

  it('is larger than the old half-width box that clipped the corners', () => {
    expect(cornerReach(HALF, CELL, SUN)).toBeGreaterThan(HALF + CELL);           // the old box was too small
    expect(shadowHalfExtent(HALF, CELL, SUN)).toBeGreaterThan(HALF + CELL);
  });

  it('adds the requested margin', () => {
    expect(shadowHalfExtent(HALF, CELL, SUN, 10)).toBe(shadowHalfExtent(HALF, CELL, SUN) + 10);
  });

  it('for a light straight overhead equals the board corner radius', () => {
    expect(shadowHalfExtent(100, 0, { x: 0, y: 200, z: 0 })).toBe(Math.ceil(100 * Math.SQRT2));
  });

  it('grows with the board', () => {
    expect(shadowHalfExtent(130, CELL, SUN)).toBeGreaterThan(shadowHalfExtent(100, CELL, SUN));
  });
});
