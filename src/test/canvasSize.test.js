/**
 * Drawing-buffer sizing. Regression: the buffer used to be a fixed 200×200
 * logical px regardless of layout, so the browser upscaled it (~1.9× on a
 * 1080p monitor) and the board rendered soft.
 */
import { describe, it, expect } from 'vitest';
import { computeCanvasSize, MAX_PIXEL_RATIO } from '../canvasSize';

describe('computeCanvasSize', () => {
  it('follows the CSS size instead of a fixed 200px buffer', () => {
    const s = computeCanvasSize(388, 388, 1);
    expect(s.width).toBe(388);
    expect(s.height).toBe(388);
    expect(s.pixelRatio).toBe(1);
  });

  it('uses the device pixel ratio up to the cap', () => {
    expect(computeCanvasSize(350, 350, 1.5).pixelRatio).toBe(1.5);
    expect(computeCanvasSize(350, 350, 2).pixelRatio).toBe(2);
    expect(computeCanvasSize(350, 350, 3).pixelRatio).toBe(MAX_PIXEL_RATIO);
  });

  it('a square canvas gets a full-size viewport', () => {
    expect(computeCanvasSize(720, 720, 1).viewport).toEqual({ x: 0, y: 0, size: 720 });
  });

  it('a non-square canvas is letterboxed to a centred square, never stretched', () => {
    expect(computeCanvasSize(400, 300, 1).viewport).toEqual({ x: 50, y: 0, size: 300 });
    expect(computeCanvasSize(300, 400, 1).viewport).toEqual({ x: 0, y: 50, size: 300 });
  });

  it('rounds fractional CSS sizes', () => {
    const s = computeCanvasSize(387.6, 387.4, 1);
    expect(s.width).toBe(388);
    expect(s.height).toBe(387);
  });

  it('never returns a zero or invalid size (hidden or unmounted canvas)', () => {
    for (const [w, h, d] of [[0, 0, 1], [NaN, undefined, 0], [-5, 10, -1], [10, 10, NaN]]) {
      const s = computeCanvasSize(w, h, d);
      expect(s.width).toBeGreaterThanOrEqual(1);
      expect(s.height).toBeGreaterThanOrEqual(1);
      expect(s.pixelRatio).toBeGreaterThan(0);
      expect(s.viewport.size).toBeGreaterThanOrEqual(1);
    }
  });
});
