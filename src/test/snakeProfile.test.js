/**
 * Neck profile. Regression: the body tube started at full thickness at the head
 * centre and was taller than the head, so the collar ring was drawn across the
 * back half of the head and the head looked like a separate piece.
 */
import { describe, it, expect } from 'vitest';
import { neckProfile, headSectionAt, BODY_R, NECK_R, NECK_LEN, NECK_EXIT, HEAD_R, HEAD_SCALE } from '../snakeProfile';

const HEAD_HALF_LEN = HEAD_R * HEAD_SCALE.z;

describe('neckProfile', () => {
  it('starts at NECK_R, narrower than the body', () => {
    expect(neckProfile(0).r).toBeCloseTo(NECK_R);
    expect(NECK_R).toBeLessThan(BODY_R);
  });

  it('reaches full body radius by NECK_LEN and stays there', () => {
    expect(neckProfile(NECK_LEN).r).toBeCloseTo(BODY_R);
    expect(neckProfile(NECK_LEN * 3).r).toBeCloseTo(BODY_R);
  });

  it('widens monotonically along the neck', () => {
    let prev = 0;
    for (let d = 0; d <= NECK_LEN * 1.5; d += 0.5) { const r = neckProfile(d).r; expect(r).toBeGreaterThanOrEqual(prev - 1e-9); prev = r; }
  });

  it('rests on the ground (centreline height = radius)', () => {
    for (let d = 0; d <= NECK_LEN; d += 2) { const n = neckProfile(d); expect(n.y).toBeCloseTo(n.r); }
  });

  it('respects the tail taper passed in (never wider than the body would be)', () => {
    const tapered = BODY_R * 0.5;
    for (let d = 0; d <= NECK_LEN * 2; d += 1) expect(neckProfile(d, tapered).r).toBeLessThanOrEqual(Math.max(NECK_R, tapered) + 1e-9);
  });
});

describe('neck vs head', () => {
  it('stays fully inside the head until it exits at the back', () => {
    for (let d = 0; d < NECK_EXIT; d += 0.25) {
      const h = headSectionAt(d), n = neckProfile(d);
      expect(h).not.toBeNull();
      expect(n.y + n.r).toBeLessThanOrEqual(h.top);
      expect(n.r).toBeLessThanOrEqual(h.halfWidth);
    }
  });

  it('exits in the back half of the head, not across its middle', () => {
    expect(NECK_EXIT).toBeGreaterThan(HEAD_HALF_LEN * 0.6);
    expect(NECK_EXIT).toBeLessThan(HEAD_HALF_LEN);
  });

  it('the old full-thickness start would have cut through the top of the head', () => {
    const h = headSectionAt(0);
    expect(BODY_R + BODY_R).toBeGreaterThan(h.top);   // old tube top at the head centre
  });
});
