/**
 * Integration tests for the useSnake hook.
 *
 * Covers the state machine, tick loop, direction queue, level progression,
 * localStorage persistence, wrap-around mode, and visibility-change
 * auto-pause/resume.
 *
 * Uses @testing-library/react's renderHook + act so the hook runs in a
 * realistic React environment with proper batching and effect flushing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSnake, buildObstacles, spawnExclusions, LOOKAHEAD,
  placePendingObstacles, HEAD_CLEARANCE, bestKey, LEGACY_BEST_KEYS,
} from '../hooks/useSnake';
import { COLS, ROWS, DIR } from '../constants';
import { getLevel, SPAWN_ROW, SPAWN_HEAD_X } from '../levels';
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
// Same derivation as useSnake's INIT_SNAKE (board centre, heading right).
const INIT_SNAKE = [0, 1, 2].map(i => ({ x: SPAWN_HEAD_X - i, y: SPAWN_ROW }));
const CLASSIC_BEST = bestKey(false);
const WRAP_BEST    = bestKey(true);

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
    localStorage.setItem(CLASSIC_BEST, '120');
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

// ─── Turn steering (Chase cam) ────────────────────────────────────────────────

describe('turn steering', () => {
  const headOf = (result) => ({ ...segPool[result.current.headIdxRef.current % POOL_SIZE] });

  it('screen directions pass straight through without turn steering', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.steer(DIR.UP));
    const h0 = headOf(result);
    tick();
    expect(headOf(result)).toEqual({ x: h0.x, y: h0.y - 1 });
  });

  it('left / right turn relative to the heading; up / down only start the game', () => {
    const { result } = renderHook(() => useSnake({ turnSteering: true }));
    act(() => result.current.steer(DIR.UP));          // starts, keeps heading right
    expect(result.current.state).toBe('running');
    let h = headOf(result);
    tick();
    expect(headOf(result)).toEqual({ x: h.x + 1, y: h.y });

    act(() => result.current.steer(DIR.LEFT));        // right → turn left → up
    h = headOf(result);
    tick();
    expect(headOf(result)).toEqual({ x: h.x, y: h.y - 1 });

    act(() => result.current.steer(DIR.DOWN));        // ignored while running
    act(() => result.current.steer(DIR.RIGHT));       // up → turn right → right
    h = headOf(result);
    tick();
    expect(headOf(result)).toEqual({ x: h.x + 1, y: h.y });
  });

  it('two quick turns build on the queued heading', () => {
    const { result } = renderHook(() => useSnake({ turnSteering: true }));
    act(() => result.current.steer(DIR.UP));
    act(() => { result.current.steer(DIR.LEFT); result.current.steer(DIR.LEFT); });   // right → up → left
    const h = headOf(result);
    tick(); tick();
    expect(headOf(result)).toEqual({ x: h.x - 1, y: h.y - 1 });
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
    expect(localStorage.getItem(CLASSIC_BEST)).toBe('10');
  });

  it('best persists across reset', () => {
    localStorage.setItem(CLASSIC_BEST, '80');
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
      expect(ex.has((SPAWN_HEAD_X + k) * ROWS + SPAWN_ROW)).toBe(true);
    }
  });

  it('follows the head direction, not a fixed axis', () => {
    const ex = spawnExclusions(0, 3, DIR.UP, DUMMY_FOOD);
    expect(ex.has(SPAWN_HEAD_X * ROWS + SPAWN_ROW - 1)).toBe(true);        // one cell up
    expect(ex.has(SPAWN_HEAD_X * ROWS + SPAWN_ROW - 2)).toBe(true);        // two cells up
    expect(ex.has((SPAWN_HEAD_X + 1) * ROWS + SPAWN_ROW)).toBe(false);     // not the rightward path
  });

  it('excludes the current food cell', () => {
    const ex = spawnExclusions(0, 3, DIR.RIGHT, DUMMY_FOOD);
    expect(ex.has(DUMMY_FOOD.x * ROWS + DUMMY_FOOD.y)).toBe(true);
  });

  it('tolerates a null food and an off-board look-ahead', () => {
    initPool([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(() => spawnExclusions(0, 3, DIR.LEFT, null)).not.toThrow();
  });

  it('wraps the look-ahead onto the opposite edge in wrap mode', () => {
    initPool([{ x: COLS - 1, y: 5 }, { x: COLS - 2, y: 5 }, { x: COLS - 3, y: 5 }]);
    const classic = spawnExclusions(0, 3, DIR.RIGHT, DUMMY_FOOD);
    const wrapped = spawnExclusions(0, 3, DIR.RIGHT, DUMMY_FOOD, true);
    for (let k = 1; k <= LOOKAHEAD; k++) {
      const key = (k - 1) * ROWS + 5;   // (0,5), (1,5): just past the right edge
      expect(classic.has(key)).toBe(false);
      expect(wrapped.has(key)).toBe(true);
    }
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
    act(() => result.current.applyDir(DIR.UP));   // head at the spawn cell, moving up
    act(() => {
      // Wall off the cell directly ahead
      result.current.obstaclesRef.current = {
        set: new Set([SPAWN_HEAD_X * ROWS + SPAWN_ROW - 1]),
        cells: [{ x: SPAWN_HEAD_X, y: SPAWN_ROW - 1 }],
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
        if (x === SPAWN_HEAD_X) continue;  // keep the snake's column clear
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

// ─── Deferred obstacles ───────────────────────────────────────────────────────
// Regression: a level-up used to drop every layout cell under the snake for the
// rest of the level (playtest: L09 kept 2 of 8 walls). Those cells now wait in
// `pending` and drop in once clear.

describe('deferred obstacles', () => {
  const key = (x, y) => x * ROWS + y;
  const record = (pending) => ({ set: new Set(), cells: [], pending, version: 0 });
  // Head (5,1) heading right, body trailing left; far from the spawn row.
  const SNAKE_TOP = [{ x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }];
  const FAR_FOOD  = { x: 0, y: ROWS - 1 };

  it('buildObstacles holds excluded layout cells as pending instead of dropping them', () => {
    const lvl = 12;
    const all = getLevel(lvl).obstacles;
    const excluded = new Set([key(all[0].x, all[0].y), key(all[1].x, all[1].y)]);
    const r = buildObstacles(lvl, excluded);
    expect(r.pending).toEqual([all[0], all[1]]);
    expect(r.cells.length + r.pending.length).toBe(all.length);
    expect(r.set.has(key(all[0].x, all[0].y))).toBe(false);
  });

  it('every built record gets a newer version', () => {
    const a = buildObstacles(5);
    const b = buildObstacles(5);
    expect(b.version).toBeGreaterThan(a.version);
  });

  it('places a pending cell once nothing excludes it, and bumps the version', () => {
    initPool(SNAKE_TOP);
    const r = record([{ x: 3, y: 7 }]);
    expect(placePendingObstacles(r, 0, 3, DIR.RIGHT, FAR_FOOD)).toBe(true);
    expect(r.set.has(key(3, 7))).toBe(true);
    expect(r.cells).toEqual([{ x: 3, y: 7 }]);
    expect(r.pending).toEqual([]);
    expect(r.version).toBeGreaterThan(0);
  });

  it('keeps a cell pending while the snake is on it', () => {
    initPool(SNAKE_TOP);
    const r = record([{ x: 3, y: 1 }]);   // the tail
    expect(placePendingObstacles(r, 0, 3, DIR.RIGHT, FAR_FOOD)).toBe(false);
    expect(r.pending).toEqual([{ x: 3, y: 1 }]);
    expect(r.version).toBe(0);
  });

  it('keeps a cell pending while the food is on it', () => {
    initPool(SNAKE_TOP);
    const r = record([{ ...FAR_FOOD }]);
    expect(placePendingObstacles(r, 0, 3, DIR.RIGHT, FAR_FOOD)).toBe(false);
  });

  it(`never drops a wall within ${HEAD_CLEARANCE} steps of the head, in any direction`, () => {
    initPool(SNAKE_TOP);
    const near = [{ x: 5, y: 3 }, { x: 6, y: 2 }, { x: 7, y: 1 }, { x: 5, y: 0 }];
    const r = record(near.map(c => ({ ...c })));
    expect(placePendingObstacles(r, 0, 3, DIR.RIGHT, FAR_FOOD)).toBe(false);
    expect(r.pending.length).toBe(near.length);
  });

  it('wrap mode measures head clearance across the edge', () => {
    initPool([{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }]);   // head on the left edge, heading left
    const edge = { x: COLS - 1, y: 4 };                              // 1 step across the wrap + 1 up = 2
    const wrapped = record([{ ...edge }]);
    expect(placePendingObstacles(wrapped, 0, 3, DIR.LEFT, FAR_FOOD, true)).toBe(false);
    const classic = record([{ ...edge }]);
    expect(placePendingObstacles(classic, 0, 3, DIR.LEFT, FAR_FOOD, false)).toBe(true);
  });

  it('a wall under the tail drops in during play once the tail moves off', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));   // snake (5,5),(4,5),(3,5) → heading up
    act(() => {
      result.current.obstaclesRef.current = record([{ x: 3, y: 5 }]);   // under the tail
      result.current.foodRef.current = { ...FAR_FOOD };
    });
    tick(0);   // head → (5,4); tail leaves (3,5), now 3 steps from the head
    expect(result.current.state).toBe('running');
    expect(result.current.obstaclesRef.current.set.has(key(3, 5))).toBe(true);
    expect(result.current.obstaclesRef.current.pending).toEqual([]);
  });
});

// ─── Best-score reset on board resize ─────────────────────────────────────────
// Records from the 10×10 board are not comparable with 13×13, so best scores
// are keyed per board size and the 10×10-era keys are retired.

describe('best scores per board size', () => {
  it('keys records by grid size and mode', () => {
    expect(bestKey(false)).toBe(`snakeBest_${COLS}x${ROWS}`);
    expect(bestKey(true)).toBe(`snakeBestWrap_${COLS}x${ROWS}`);
  });

  it('does not carry a 10×10-era record over to the new board', () => {
    localStorage.setItem('snakeBest', '900');
    localStorage.setItem('snakeBestWrap', '700');
    const { result } = renderHook(() => useSnake());
    expect(result.current.best).toBe(0);
  });

  it('removes the legacy keys on mount', () => {
    for (const k of LEGACY_BEST_KEYS) localStorage.setItem(k, '500');
    renderHook(() => useSnake());
    for (const k of LEGACY_BEST_KEYS) expect(localStorage.getItem(k)).toBeNull();
  });

  it('keeps a record set on the current board', () => {
    localStorage.setItem(bestKey(false), '340');
    const { result } = renderHook(() => useSnake());
    expect(result.current.best).toBe(340);
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => renderHook(() => useSnake())).not.toThrow();
  });
});

// ─── Wrap-around mode ─────────────────────────────────────────────────────────

describe('wrap mode', () => {
  const headOf = (result) => segPool[result.current.headIdxRef.current % POOL_SIZE];

  it('defaults to classic walls', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.wrap).toBe(false);
  });

  it('restores the persisted mode on mount', () => {
    localStorage.setItem('snakeWrap', '1');
    const { result } = renderHook(() => useSnake());
    expect(result.current.wrap).toBe(true);
  });

  it('toggles from idle and persists the choice', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.toggleWrap());
    expect(result.current.wrap).toBe(true);
    expect(localStorage.getItem('snakeWrap')).toBe('1');
    act(() => result.current.toggleWrap());
    expect(result.current.wrap).toBe(false);
    expect(localStorage.getItem('snakeWrap')).toBe('0');
  });

  it('exits the top edge and re-enters at the bottom', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.toggleWrap());
    act(() => result.current.applyDir(DIR.UP));
    for (let i = 0; i <= SPAWN_ROW; i++) tick();   // up to row 0, then across the edge
    expect(result.current.state).toBe('running');
    expect(headOf(result)).toMatchObject({ x: SPAWN_HEAD_X, y: ROWS - 1 });
  });

  it('exits the right edge and re-enters at the left', () => {
    const { result } = renderHook(() => useSnake());
    act(() => { result.current.foodRef.current = { x: 0, y: 0 }; });  // off the path
    act(() => result.current.toggleWrap());
    act(() => result.current.applyDir(DIR.RIGHT));   // starts the run (already heading right)
    const steps = COLS - SPAWN_HEAD_X;     // to the last column, then across the edge
    for (let i = 0; i < steps; i++) tick();
    expect(result.current.state).toBe('running');
    expect(headOf(result)).toMatchObject({ x: 0, y: SPAWN_ROW });
  });

  it('is locked while a run is in progress', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => result.current.toggleWrap());
    expect(result.current.wrap).toBe(false);
    act(() => result.current.pause());
    act(() => result.current.toggleWrap());
    expect(result.current.wrap).toBe(false);
  });

  it('can be toggled after game over', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.applyDir(DIR.UP));
    act(() => { vi.advanceTimersByTime(getLevel(0).speed * 8); });
    expect(result.current.state).toBe('dead');
    act(() => result.current.toggleWrap());
    expect(result.current.wrap).toBe(true);
  });

  it('tracks best score separately per mode', () => {
    localStorage.setItem(CLASSIC_BEST, '50');
    localStorage.setItem(WRAP_BEST, '20');
    const { result } = renderHook(() => useSnake());
    expect(result.current.best).toBe(50);
    act(() => result.current.toggleWrap());
    expect(result.current.best).toBe(20);
    act(() => result.current.toggleWrap());
    expect(result.current.best).toBe(50);
  });

  it('records a wrap-mode best under its own key only', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.toggleWrap());
    act(() => result.current.applyDir(DIR.UP));
    placeFoodAhead(result);
    tick();
    expect(result.current.best).toBe(10);
    expect(localStorage.getItem(WRAP_BEST)).toBe('10');
    expect(localStorage.getItem(CLASSIC_BEST)).toBeNull();
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
    localStorage.setItem(CLASSIC_BEST, 'not-a-number');
    const { result } = renderHook(() => useSnake());
    // parseInt('not-a-number') = NaN; readBestScore must sanitize it to exactly 0
    // so it renders correctly and doesn't permanently block best-score updates.
    expect(result.current.best).toBe(0);
  });

  it('treats a negative localStorage value as 0', () => {
    localStorage.setItem(CLASSIC_BEST, '-50');
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

// ─── Autopilot ────────────────────────────────────────────────────────────────

describe('autopilot', () => {
  it('is off by default and turning it on from idle starts the run', () => {
    const { result } = renderHook(() => useSnake());
    expect(result.current.autopilot).toBe(false);
    act(() => result.current.toggleAutopilot());
    expect(result.current.autopilot).toBe(true);
    expect(result.current.state).toBe('running');
  });

  it('marks the run assisted and never writes a best score', () => {
    localStorage.setItem(CLASSIC_BEST, '0');
    const { result } = renderHook(() => useSnake());
    act(() => result.current.toggleAutopilot());
    // Food straight ahead: the autopilot takes it.
    act(() => {
      const h = segPool[result.current.headIdxRef.current % POOL_SIZE];
      result.current.foodRef.current = { x: h.x + 1, y: h.y };
    });
    tick();
    expect(result.current.score).toBe(10);
    expect(result.current.assisted).toBe(true);
    expect(result.current.best).toBe(0);
    expect(localStorage.getItem(CLASSIC_BEST)).toBe('0');
  });

  it('player steering mid-run takes back control, but the run stays assisted', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.toggleAutopilot());
    tick();
    act(() => result.current.steer(DIR.UP));
    expect(result.current.autopilot).toBe(false);
    expect(result.current.assisted).toBe(true);
  });

  it('reset clears the assisted flag but keeps autopilot on', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.toggleAutopilot());
    tick();
    act(() => result.current.reset());
    expect(result.current.assisted).toBe(false);
    expect(result.current.autopilot).toBe(true);
    expect(result.current.state).toBe('idle');
  });

  it('keeps the snake alive where manual input would crash into the wall', () => {
    const { result } = renderHook(() => useSnake());
    act(() => result.current.toggleAutopilot());
    for (let i = 0; i < COLS + 2; i++) tick();
    expect(result.current.state).toBe('running');
  });
});
