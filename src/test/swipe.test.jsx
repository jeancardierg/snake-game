import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { swipeDir } from '../swipe';
import { DIR, SWIPE_THRESHOLD } from '../constants';

// App wiring: GameCanvas needs WebGL, and steer is wrapped to record calls.
const steered = [];
vi.mock('../components/GameCanvas', () => ({ GameCanvas: () => <div data-testid="board" /> }));
vi.mock('../hooks/useSnake', async (orig) => {
  const mod = await orig();
  return {
    ...mod,
    useSnake: (opts) => {
      const r = mod.useSnake(opts);
      return { ...r, steer: (d) => { steered.push(d); r.steer(d); } };
    },
  };
});
const { default: App } = await import('../App');

describe('swipeDir', () => {
  it('ignores travel below the threshold', () => {
    expect(swipeDir(SWIPE_THRESHOLD - 1, -(SWIPE_THRESHOLD - 1), SWIPE_THRESHOLD)).toBeNull();
  });
  it('picks the dominant axis', () => {
    expect(swipeDir(30, 10, 20)).toBe(DIR.RIGHT);
    expect(swipeDir(-30, 10, 20)).toBe(DIR.LEFT);
    expect(swipeDir(5, 30, 20)).toBe(DIR.DOWN);
    expect(swipeDir(5, -30, 20)).toBe(DIR.UP);
  });
  it('breaks a diagonal tie toward x', () => {
    expect(swipeDir(25, 25, 20)).toBe(DIR.RIGHT);
  });
});

describe('swipe on the board', () => {
  const touch = (x, y) => [{ clientX: x, clientY: y }];
  const board = () => document.querySelector('.canvas-wrap');

  it('steers mid-gesture, before the finger lifts', () => {
    steered.length = 0;
    render(<App />);
    fireEvent.touchStart(board(), { touches: touch(100, 100) });
    fireEvent.touchMove(board(), { touches: touch(110, 100) });
    expect(steered).toEqual([]);
    fireEvent.touchMove(board(), { touches: touch(130, 100) });
    expect(steered).toEqual([DIR.RIGHT]);
    fireEvent.touchMove(board(), { touches: touch(180, 100) });   // still right: not re-fired
    fireEvent.touchMove(board(), { touches: touch(180, 60) });    // L-stroke: second turn
    fireEvent.touchEnd(board(), { changedTouches: touch(180, 60) });
    expect(steered).toEqual([DIR.RIGHT, DIR.UP]);
  });

  it('still catches a flick that only crosses the threshold on lift', () => {
    steered.length = 0;
    render(<App />);
    fireEvent.touchStart(board(), { touches: touch(100, 100) });
    fireEvent.touchEnd(board(), { changedTouches: touch(100, 140) });
    expect(steered).toEqual([DIR.DOWN]);
  });
});
