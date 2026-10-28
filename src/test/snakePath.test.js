/**
 * Body path. Regression: the body was a spline refit every frame through
 * segment points sliding between cells, so corners changed shape once per tick
 * and the whole body wiggled on turns.
 */
import { describe, it, expect } from 'vitest';
import { CELL } from '../constants';
import { cornerRadius, filletRadii, samplePath, slitherOffset, CORNER_R, SLITHER_AMP, SLITHER_WAVE } from '../snakePath';

// Head at (0,0) facing −Z (came up from below), turned at (0,1) from +X travel:
// vertices head → tail: (0,0) (0,1) (−1,1) (−2,1) (−3,1), in cells.
const cells = [[0, 0], [0, 1], [-1, 1], [-2, 1], [-3, 1]];
const vx = cells.map(c => c[0] * CELL);
const vz = cells.map(c => c[1] * CELL);
const n  = cells.length;
const vr = new Float32Array(n);
const at = (D) => samplePath(vx, vz, vr, n, D, { x: 0, z: 0, tx: 0, tz: 0 });

describe('cornerRadius', () => {
  it('is 0 at the head and opens to CORNER_R as the head moves away', () => {
    expect(cornerRadius(1, CELL)).toBe(0);
    expect(cornerRadius(1, CELL * 0.75)).toBeCloseTo(CELL * 0.25);
    expect(cornerRadius(1, 0)).toBe(CORNER_R);
    expect(cornerRadius(3, 0)).toBe(CORNER_R);
  });

  it('never puts the head inside a fillet', () => {
    for (let h = 0; h <= CELL; h += 0.5) expect(h + cornerRadius(1, h)).toBeLessThanOrEqual(CELL + 1e-9);
  });
});

describe('filletRadii', () => {
  it('rounds turns only', () => {
    filletRadii(vx, vz, vr, n, 0);
    expect([...vr]).toEqual([0, CORNER_R, 0, 0, 0]);
  });
});

describe('samplePath', () => {
  filletRadii(vx, vz, vr, n, 0);

  it('passes through straight legs exactly', () => {
    const p = at(CELL * 0.25);
    expect(p.x).toBeCloseTo(0); expect(p.z).toBeCloseTo(CELL * 0.25);
    const q = at(CELL * 2.5);
    expect(q.x).toBeCloseTo(-CELL * 1.5); expect(q.z).toBeCloseTo(CELL);
  });

  it('is continuous with a unit tangent and no kinks along the whole path', () => {
    let prev = at(0);
    for (let D = 0.25; D <= CELL * 4; D += 0.25) {
      const p = at(D);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThanOrEqual(0.25 + 1e-6);
      expect(Math.hypot(p.tx, p.tz)).toBeCloseTo(1);
      expect(p.tx * prev.tx + p.tz * prev.tz).toBeGreaterThan(0.99);
      prev = p;
    }
  });

  it('cuts the corner on a quarter circle of CORNER_R', () => {
    const mid = at(CELL);   // corner apex
    const cx = -CORNER_R, cz = CELL - CORNER_R;
    expect(Math.hypot(mid.x - cx, mid.z - cz)).toBeCloseTo(CORNER_R);
  });
});

describe('slitherOffset', () => {
  it('is 0 at the head and at the tail tip', () => {
    expect(slitherOffset(0, CELL * 10, 123)).toBeCloseTo(0);
    expect(slitherOffset(CELL * 10, CELL * 10, 123)).toBeCloseTo(0);
  });

  it('stays within the amplitude', () => {
    for (let d = 0; d <= CELL * 10; d += 1) expect(Math.abs(slitherOffset(d, CELL * 10, 37))).toBeLessThanOrEqual(SLITHER_AMP);
  });

  it('is pinned to the ground: same ground point, same offset as the head advances', () => {
    const total = CELL * 10, d = CELL * 5, step = CELL * 0.3;
    // The ground point d behind the head is d + step behind after moving step.
    expect(slitherOffset(d + step, total, 100 + step)).toBeCloseTo(slitherOffset(d, total, 100));
    expect(SLITHER_WAVE).toBeGreaterThan(CELL);
  });
});
