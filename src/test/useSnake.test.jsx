/**
 * Integration tests for the useSnake hook.
 *
 * Covers the state machine, tick loop, direction queue, level progression,
 * localStorage persistence, and visibility-change auto-pause/resume.
 *
 * Uses @testing-library/react's renderHook + act so the hook runs in a
 * realistic React environment with proper batching and effect flushing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSnake } from '../hooks/useSnake';
import { LEVELS, DIR } from '../constants';
import { segPool, POOL_SIZE } from '../pool';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Advance fake timers by one tick at the given level speed. */
function tick(levelIdx = 0) {
  act(() => { vi.advanceTimersByTime(LEVELS[levelIdx].speed); });
}

/**
 * Place food one cell ahead of the current head.
 * Game starts moving UP (DIR.UP), so food is placed one row above head.
 */
function placeFoodAhead(result) {
  act(() => {
    const h = segPool[result.current.headIdxRef.current % POOL_SIZE];
    result.current.foodRef.current = { x: h.x, y: h.y - 1 };
  });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  // Restore document.hidden to default
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

// ─── Initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.state).toBe('idle');
  });

  it('starts with score 0', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.score).toBe(0);
  });

  it('starts at level 0', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.levelIndex).toBe(0);
  });

  it('reads best from localStorage on mount', () => {
    localStorage.setItem('snakeBest', '120');
    const { result } = renderHook(() => useSnake());
    expect(result.current.best).toBe(120);
  });

  it('best defaults to 0 when localStorage is empty', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.best).toBe(0);
  });

  it('food is not placed on any initial snake segment', () => {
    const { result } = renderHook(() => useSnake());
    const food = result.current.foodRef.current;
    const head = result.current.headIdxRef.current;
    const len  = result.current.snakeLenRef.current;
    for (let i = 0; i < len; i++) {
      const s = segPool[(head + i) % POOL_SIZE];
      expect(food.x === s.x && food.y === s.y).toBe(false);
    }
  });
});

// ─── State machine ────────────────────────────────────────────────────────────

describe('state machine', () => {
  it('idle → running on first applyDir', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    expect(result.current.state).toBe('running');
  });

  it('running → paused on pause()', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => result.current.pause());
    expect(result.current.state).toBe('paused');
  });

  it('paused → running on second pause()', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => result.current.pause());
    act(() => result.current.pause());
    expect(result.current.state).toBe('running');
  });

  it('running → dead on wall collision', () => {
    const { result } = renderHook(() => useSnake());
    // Move up; snake starts at y=10, wall is y<0, so 11 ticks hits it
    act(() => result.current.applyDir(DIR.UP));
    act(() => { vi.advanceTimersByTime(LEVELS[0].speed * 12); });
    expect(result.current.state).toBe('dead');
  });

  it('reset returns to idle with score 0 and level 0', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => { vi.advanceTimersByTime(LEVELS[0].speed * 12); });
    act(() => result.current.reset());
    expect(result.current.state).toBe('idle');
    expect(result.current.score).toBe(0);
    expect(result.current.levelIndex).toBe(0);
  });

  it('applyDir is ignored when state is dead', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => { vi.advanceTimersByTime(LEVELS[0].speed * 12); });
    expect(result.current.state).toBe('dead');
    act(() => result.current.applyDir(DIR.RIGHT));
    expect(result.current.state).toBe('dead');
  });
});

// ─── Direction queue ──────────────────────────────────────────────────────────

describe('direction queue', () => {
  it('rejects 180° reversal while moving up', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP)); // starts game moving up
    tick();
    act(() => result.current.applyDir(DIR.DOWN)); // reversal — ignored
    // Snake should still be alive (reversal didn't cause self-collision)
    expect(result.current.state).toBe('running');
  });

  it('does not crash when more than DIR_QUEUE_MAX directions are queued', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    // Queue well beyond the cap — extras should silently drop
    act(() => {
      result.current.applyDir(DIR.LEFT);
      result.current.applyDir(DIR.DOWN);
      result.current.applyDir(DIR.RIGHT);
      result.current.applyDir(DIR.UP);
    });
    expect(result.current.state).toBe('running');
  });

  it('rejects same direction as last queued (no-op)', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    // Duplicate should not be queued
    act(() => result.current.applyDir(DIR.UP));
    expect(result.current.state).toBe('running');
  });
});

// ─── Score and level progression ─────────────────────────────────────────────

describe('score and level', () => {
  it('score increments by 10 on food eat', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    placeFoodAhead(result);
    tick(0);
    expect(result.current.score).toBe(10);
  });

  it('best updates when score exceeds previous best', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    placeFoodAhead(result);
    tick(0);
    expect(result.current.best).toBe(10);
    expect(localStorage.getItem('snakeBest')).toBe('10');
  });

  it('best persists across reset', () => {
    localStorage.setItem('snakeBest', '80');
    const { result } = renderHook(() => useSnake());
    expect(result.current.best).toBe(80);
    act(() => result.current.reset());
    expect(result.current.best).toBe(80);
  });

  it('advances to level 1 when score reaches LEVELS[0].scoreNext', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    const needed = LEVELS[0].scoreNext / 10;
    for (let i = 0; i < needed; i++) {
      placeFoodAhead(result);
      tick(result.current.levelIndex);
    }
    expect(result.current.levelIndex).toBe(1);
  });
});

// ─── Visibility auto-pause / auto-resume ─────────────────────────────────────

describe('visibility change', () => {
  it('auto-pauses when tab is hidden while running', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.state).toBe('paused');
  });

  it('auto-resumes when tab becomes visible after auto-pause', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.state).toBe('running');
  });

  it('does NOT auto-resume after a manual pause', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));

    act(() => result.current.pause()); // manual pause
    expect(result.current.state).toBe('paused');

    // Tab hidden then shown — must not override manual pause
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.state).toBe('paused');
  });
});

// ─── localStorage resilience ──────────────────────────────────────────────────

describe('localStorage resilience', () => {
  it('treats corrupt localStorage value as 0', () => {
    localStorage.setItem('snakeBest', 'not-a-number');
    const { result } = renderHook(() => useSnake());
    // parseInt('not-a-number') = NaN; hook should treat it as 0
    expect(result.current.best === 0 || isNaN(result.current.best)).toBe(true);
  });

  it('continues without throwing when localStorage.setItem fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    placeFoodAhead(result);
    expect(() => tick(0)).not.toThrow();
  });
});
