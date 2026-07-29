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
import { useSnake, buildObstacles, spawnExclusions, LOOKAHEAD } from '../hooks/useSnake';
import { COLS, ROWS, DIR } from '../constants';
import { getLevel } from '../levels';
import { segPool, POOL_SIZE, initPool } from '../pool';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Advance fake timers by one tick at the given level's *base* speed.
 *
 * The per-food speed boost only shortens the interval, so advancing by the base
 * speed always covers at least one tick.
 */
function tick(levelIdx = 0) {
  act(() => { vi.advanceTimersByTime(getLevel(levelIdx).speed); });
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

// The pool is module-level state shared by every hook instance, and useSnake
// does not re-seed it on mount (only reset() does). Any test that calls
// initPool directly would otherwise leak its snake into the tests that follow.
const INIT_SNAKE = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  initPool(INIT_SNAKE);
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
    // Move up; snake starts at y=5, wall is y<0, so 6 ticks hits it
    act(() => result.current.applyDir(DIR.UP));
    act(() => { vi.advanceTimersByTime(getLevel(0).speed * 8); });
    expect(result.current.state).toBe('dead');
  });

  it('reset returns to idle with score 0 and level 0', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => { vi.advanceTimersByTime(getLevel(0).speed * 8); });
    act(() => result.current.reset());
    expect(result.current.state).toBe('idle');
    expect(result.current.score).toBe(0);
    expect(result.current.levelIndex).toBe(0);
  });

  it('applyDir is ignored when state is dead', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => { vi.advanceTimersByTime(getLevel(0).speed * 8); });
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

  it('advances to level 1 when score reaches the level 0 threshold', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    const needed = getLevel(0).scoreNext / 10;
    for (let i = 0; i < needed; i++) {
      placeFoodAhead(result);
      tick(result.current.levelIndex);
    }
    expect(result.current.levelIndex).toBe(1);
  });

  it('announces the new level with a banner, and not before', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.banner).toBeNull();

    act(() => result.current.applyDir(DIR.UP));
    const needed = getLevel(0).scoreNext / 10;
    for (let i = 0; i < needed; i++) {
      placeFoodAhead(result);
      tick(result.current.levelIndex);
    }
    expect(result.current.banner).toEqual(getLevel(1));

    // The banner is transient — it clears itself without another level-up
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.banner).toBeNull();
  });

  it('installs a consistent obstacle record on level-up', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    const needed = getLevel(0).scoreNext / 10;
    for (let i = 0; i < needed; i++) {
      placeFoodAhead(result);
      tick(result.current.levelIndex);
    }

    const { set, cells } = result.current.obstaclesRef.current;
    expect(set.size).toBe(cells.length);
    for (const c of cells) expect(set.has(c.x * ROWS + c.y)).toBe(true);
  });
});

// ─── Mid-run layout swap ──────────────────────────────────────────────────────
// Levelling up drops a new wall layout onto a board that is already in play.
// These cover the exclusions that keep that swap survivable; the level-up path
// itself cannot reach a level with walls in a unit test (that needs ~39 foods
// eaten on a 10×10 board), so the rule is exercised directly.

describe('spawnExclusions', () => {
  const DUMMY_FOOD = { x: 9, y: 9 };

  it('excludes every cell the snake occupies', () => {
    const ex = spawnExclusions(0, 3, DIR.RIGHT, DUMMY_FOOD);
    for (const { x, y } of INIT_SNAKE) {
      expect(ex.has(x * ROWS + y)).toBe(true);
    }
  });

  it('excludes the cells directly ahead of the head', () => {
    const ex = spawnExclusions(0, 3, DIR.RIGHT, DUMMY_FOOD);
    for (let k = 1; k <= LOOKAHEAD; k++) {
      expect(ex.has((5 + k) * ROWS + 5)).toBe(true);
    }
  });

  it('follows the head direction, not a fixed axis', () => {
    const ex = spawnExclusions(0, 3, DIR.UP, DUMMY_FOOD);
    expect(ex.has(5 * ROWS + 4)).toBe(true);   // one cell up
    expect(ex.has(5 * ROWS + 3)).toBe(true);   // two cells up
    expect(ex.has(6 * ROWS + 5)).toBe(false);  // not the old rightward path
  });

  it('excludes the current food cell', () => {
    const ex = spawnExclusions(0, 3, DIR.RIGHT, DUMMY_FOOD);
    expect(ex.has(DUMMY_FOOD.x * ROWS + DUMMY_FOOD.y)).toBe(true);
  });

  it('tolerates a null food and an off-board look-ahead', () => {
    initPool([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(() => spawnExclusions(0, 3, DIR.LEFT, null)).not.toThrow();
  });
});

describe('buildObstacles', () => {
  it('drops every excluded cell from the layout', () => {
    // Find a level that actually generates walls, then exclude them all
    let lvl = 0;
    while (getLevel(lvl).obstacles.length === 0 && lvl < 60) lvl++;
    const layout = getLevel(lvl).obstacles;
    expect(layout.length).toBeGreaterThan(0);

    const excluded = new Set(layout.map(c => c.x * ROWS + c.y));
    const built = buildObstacles(lvl, excluded);
    expect(built.cells).toEqual([]);
    expect(built.set.size).toBe(0);
  });

  it('keeps the layout intact when nothing is excluded', () => {
    let lvl = 0;
    while (getLevel(lvl).obstacles.length === 0 && lvl < 60) lvl++;
    const built = buildObstacles(lvl, new Set());
    expect(built.cells).toEqual(getLevel(lvl).obstacles);
    expect(built.set.size).toBe(built.cells.length);
  });

  it('drops only the excluded cells, not their neighbours', () => {
    let lvl = 0;
    while (getLevel(lvl).obstacles.length < 2 && lvl < 60) lvl++;
    const layout = getLevel(lvl).obstacles;
    const victim = layout[0];
    const built = buildObstacles(lvl, new Set([victim.x * ROWS + victim.y]));
    expect(built.cells.length).toBe(layout.length - 1);
    expect(built.set.has(victim.x * ROWS + victim.y)).toBe(false);
  });
});

// ─── Obstacles ────────────────────────────────────────────────────────────────

describe('obstacles', () => {
  it('kills the snake when the head runs into one', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));   // head at (5,5), moving up
    act(() => {
      // Wall off the cell directly ahead
      result.current.obstaclesRef.current = {
        set: new Set([5 * ROWS + 4]),
        cells: [{ x: 5, y: 4 }],
      };
    });
    tick(0);
    expect(result.current.state).toBe('dead');
  });

  it('does not kill the snake on a cell that has no obstacle', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => {
      result.current.obstaclesRef.current = {
        set: new Set([0 * ROWS + 0]),
        cells: [{ x: 0, y: 0 }],
      };
    });
    tick(0);
    expect(result.current.state).toBe('running');
  });

  it('never spawns food on an obstacle cell', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));

    // Block most of the board so a naive spawn would almost certainly land on
    // an obstacle, leaving only the top-left column and the snake's own column.
    const blocked = [];
    for (let x = 2; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        if (x === 5) continue;             // keep the snake's column clear
        blocked.push({ x, y });
      }
    }
    act(() => {
      result.current.obstaclesRef.current = {
        set: new Set(blocked.map(c => c.x * ROWS + c.y)),
        cells: blocked,
      };
    });

    placeFoodAhead(result);
    tick(0);
    expect(result.current.score).toBe(10);

    const food = result.current.foodRef.current;
    expect(result.current.obstaclesRef.current.set.has(food.x * ROWS + food.y)).toBe(false);
  });

  it('starts with an empty layout on level 0', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.obstaclesRef.current.cells).toEqual([]);
  });
});

// ─── Self-collision (tail-follow) ─────────────────────────────────────────────

describe('self-collision', () => {
  /**
   * Lay out an explicit snake in the pool at headIdx 0 and set the live refs.
   * segs is head-first: segs[0] = head … segs[len-1] = tail.
   */
  function placeSnake(result, segs) {
    act(() => {
      for (let i = 0; i < segs.length; i++) {
        segPool[i].x = segs[i].x;
        segPool[i].y = segs[i].y;
      }
      result.current.headIdxRef.current  = 0;
      result.current.snakeLenRef.current = segs.length;
    });
  }

  it('does NOT die when the head moves into the tail cell while not eating', () => {
    const { result } = renderHook(() => useSnake());
    // Start moving (dir defaults to RIGHT) and queue a 90° UP turn.
    act(() => result.current.applyDir(DIR.UP));
    // Bend the snake so UP from the head lands on the CURRENT tail cell:
    // head (5,5) --UP--> (5,4); tail is at (5,4) and vacates on this tick.
    placeSnake(result, [
      { x: 5, y: 5 }, // head
      { x: 4, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 4 }, // tail — the cell the head is about to enter
    ]);
    // Food elsewhere → non-eating tick.
    act(() => { result.current.foodRef.current = { x: 0, y: 0 }; });
    tick(0);
    expect(result.current.state).toBe('running');
  });

  it('DOES die when the head moves into a non-tail body segment', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    // head (5,5) --UP--> (5,4); (5,4) is a MIDDLE segment (tail is elsewhere).
    placeSnake(result, [
      { x: 5, y: 5 }, // head
      { x: 4, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 4 }, // middle segment lying in the head's path
      { x: 6, y: 4 }, // tail
    ]);
    act(() => { result.current.foodRef.current = { x: 0, y: 0 }; });
    tick(0);
    expect(result.current.state).toBe('dead');
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
  it('treats corrupt localStorage value as 0 (not NaN)', () => {
    localStorage.setItem('snakeBest', 'not-a-number');
    const { result } = renderHook(() => useSnake());
    // parseInt('not-a-number') = NaN; readBestScore must sanitize it to exactly 0
    // so it renders correctly and doesn't permanently block best-score updates.
    expect(result.current.best).toBe(0);
  });

  it('treats a negative localStorage value as 0', () => {
    localStorage.setItem('snakeBest', '-50');
    const { result } = renderHook(() => useSnake());
    expect(result.current.best).toBe(0);
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
