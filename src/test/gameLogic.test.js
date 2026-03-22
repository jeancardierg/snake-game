/**
 * Unit tests for core snake game mechanics.
 *
 * These tests exercise the pure-logic layer: constants, direction vectors,
 * level progression math, and the stateless helper functions that power the
 * game loop.  React rendering and hook side-effects are intentionally NOT
 * covered here — see useSnake.test.jsx for integration-level hook tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { COLS, ROWS, LEVELS, DIR } from '../constants';
import { segPool, POOL_SIZE, initPool, poolGet, poolPrepend } from '../pool';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('defines a 20×20 grid', () => {
    expect(COLS).toBe(20);
    expect(ROWS).toBe(20);
  });

  it('has exactly 5 levels', () => {
    expect(LEVELS).toHaveLength(5);
  });

  it('levels are ordered from slowest to fastest (decreasing speed ms)', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].speed).toBeLessThan(LEVELS[i - 1].speed);
    }
  });

  it('each level has a higher score threshold than the previous', () => {
    for (let i = 1; i < LEVELS.length - 1; i++) {
      expect(LEVELS[i].scoreNext).toBeGreaterThan(LEVELS[i - 1].scoreNext);
    }
  });

  it('final level (INSANE) has Infinity scoreNext so the player never leaves it', () => {
    expect(LEVELS[LEVELS.length - 1].scoreNext).toBe(Infinity);
  });

  it('every level has a non-empty color string', () => {
    LEVELS.forEach(lvl => {
      expect(typeof lvl.color).toBe('string');
      expect(lvl.color.length).toBeGreaterThan(0);
    });
  });
});

// ─── Direction vectors ────────────────────────────────────────────────────────

describe('DIR vectors', () => {
  it('UP decreases y', () => {
    expect(DIR.UP).toEqual({ x: 0, y: -1 });
  });

  it('DOWN increases y', () => {
    expect(DIR.DOWN).toEqual({ x: 0, y: 1 });
  });

  it('LEFT decreases x', () => {
    expect(DIR.LEFT).toEqual({ x: -1, y: 0 });
  });

  it('RIGHT increases x', () => {
    expect(DIR.RIGHT).toEqual({ x: 1, y: 0 });
  });

  it('opposite directions cancel to zero', () => {
    expect(DIR.UP.x + DIR.DOWN.x).toBe(0);
    expect(DIR.UP.y + DIR.DOWN.y).toBe(0);
    expect(DIR.LEFT.x + DIR.RIGHT.x).toBe(0);
    expect(DIR.LEFT.y + DIR.RIGHT.y).toBe(0);
  });
});

// ─── Pure game-logic helpers ──────────────────────────────────────────────────
// These functions are extracted / re-implemented here as pure functions so they
// can be tested without mounting the hook.  They must stay in sync with the
// implementations in useSnake.js and the tick loop in useSnake.js.

/**
 * Returns true if `newDir` is a 180° reversal of `curDir`.
 * Mirrors the guard inside tick() and applyDir().
 */
function isReversal(curDir, newDir) {
  return newDir.x === -curDir.x && newDir.y === -curDir.y;
}

/**
 * Compute the head position after moving one step.
 * Mirrors the head computation inside tick().
 */
function nextHead(head, dir) {
  return { x: head.x + dir.x, y: head.y + dir.y };
}

/**
 * Returns true if the head is outside the board boundaries.
 * Mirrors the wall-collision check in tick().
 */
function isWallCollision(head) {
  return head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS;
}

/**
 * Returns true if the head occupies any segment of the snake body.
 * Mirrors the self-collision check in tick().
 */
function isSelfCollision(head, snake) {
  return snake.some(s => s.x === head.x && s.y === head.y);
}

/**
 * Determine which level index a given score maps to.
 * Mirrors the while-loop inside tick() that handles level-up.
 */
function levelForScore(score) {
  let lvl = 0;
  while (lvl < LEVELS.length - 1 && score >= LEVELS[lvl].scoreNext) lvl++;
  return lvl;
}

// ── Reversal detection ────────────────────────────────────────────────────────

describe('isReversal', () => {
  it('detects right→left as a reversal', () => {
    expect(isReversal(DIR.RIGHT, DIR.LEFT)).toBe(true);
  });

  it('detects left→right as a reversal', () => {
    expect(isReversal(DIR.LEFT, DIR.RIGHT)).toBe(true);
  });

  it('detects up→down as a reversal', () => {
    expect(isReversal(DIR.UP, DIR.DOWN)).toBe(true);
  });

  it('detects down→up as a reversal', () => {
    expect(isReversal(DIR.DOWN, DIR.UP)).toBe(true);
  });

  it('does NOT flag a 90° turn as a reversal', () => {
    expect(isReversal(DIR.RIGHT, DIR.UP)).toBe(false);
    expect(isReversal(DIR.RIGHT, DIR.DOWN)).toBe(false);
    expect(isReversal(DIR.UP, DIR.LEFT)).toBe(false);
    expect(isReversal(DIR.UP, DIR.RIGHT)).toBe(false);
  });

  it('does NOT flag same direction as a reversal', () => {
    expect(isReversal(DIR.RIGHT, DIR.RIGHT)).toBe(false);
    expect(isReversal(DIR.UP, DIR.UP)).toBe(false);
  });
});

// ── Head movement ─────────────────────────────────────────────────────────────

describe('nextHead', () => {
  it('moves right by one cell', () => {
    expect(nextHead({ x: 5, y: 5 }, DIR.RIGHT)).toEqual({ x: 6, y: 5 });
  });

  it('moves left by one cell', () => {
    expect(nextHead({ x: 5, y: 5 }, DIR.LEFT)).toEqual({ x: 4, y: 5 });
  });

  it('moves up by one cell (y decreases)', () => {
    expect(nextHead({ x: 5, y: 5 }, DIR.UP)).toEqual({ x: 5, y: 4 });
  });

  it('moves down by one cell (y increases)', () => {
    expect(nextHead({ x: 5, y: 5 }, DIR.DOWN)).toEqual({ x: 5, y: 6 });
  });
});

// ── Wall collision ────────────────────────────────────────────────────────────

describe('isWallCollision', () => {
  it('no collision inside the board', () => {
    expect(isWallCollision({ x: 0, y: 0 })).toBe(false);
    expect(isWallCollision({ x: COLS - 1, y: ROWS - 1 })).toBe(false);
    expect(isWallCollision({ x: 10, y: 10 })).toBe(false);
  });

  it('left wall: x < 0', () => {
    expect(isWallCollision({ x: -1, y: 5 })).toBe(true);
  });

  it('right wall: x >= COLS', () => {
    expect(isWallCollision({ x: COLS, y: 5 })).toBe(true);
  });

  it('top wall: y < 0', () => {
    expect(isWallCollision({ x: 5, y: -1 })).toBe(true);
  });

  it('bottom wall: y >= ROWS', () => {
    expect(isWallCollision({ x: 5, y: ROWS })).toBe(true);
  });
});

// ── Self collision ────────────────────────────────────────────────────────────

describe('isSelfCollision', () => {
  const snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];

  it('detects collision when head lands on a body segment', () => {
    expect(isSelfCollision({ x: 4, y: 5 }, snake)).toBe(true);
    expect(isSelfCollision({ x: 3, y: 5 }, snake)).toBe(true);
  });

  it('no collision when head is on an empty cell', () => {
    expect(isSelfCollision({ x: 6, y: 5 }, snake)).toBe(false);
    expect(isSelfCollision({ x: 5, y: 6 }, snake)).toBe(false);
  });

  it('no collision with an empty snake array', () => {
    expect(isSelfCollision({ x: 0, y: 0 }, [])).toBe(false);
  });
});

// ── Object pool (ring buffer) ─────────────────────────────────────────────────

describe('pool', () => {
  const SEGS = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];

  beforeEach(() => {
    // Restore a known pool state before each test
    initPool(SEGS);
  });

  it('initPool writes segments head-first and returns headIdx 0', () => {
    const hi = initPool(SEGS);
    expect(hi).toBe(0);
    expect(segPool[0]).toEqual({ x: 10, y: 10 });
    expect(segPool[1]).toEqual({ x: 9,  y: 10 });
    expect(segPool[2]).toEqual({ x: 8,  y: 10 });
  });

  it('poolGet returns correct segment at each logical index', () => {
    expect(poolGet(0, 0)).toEqual({ x: 10, y: 10 });  // head
    expect(poolGet(0, 1)).toEqual({ x: 9,  y: 10 });
    expect(poolGet(0, 2)).toEqual({ x: 8,  y: 10 });  // tail
  });

  it('poolPrepend inserts a new head and returns updated headIdx', () => {
    const newHead = poolPrepend(0, 11, 10);
    expect(newHead).toBe(POOL_SIZE - 1);       // wraps to end of pool
    expect(segPool[newHead]).toEqual({ x: 11, y: 10 });
    // Old head is now at logical index 1
    expect(poolGet(newHead, 1)).toEqual({ x: 10, y: 10 });
    expect(poolGet(newHead, 2)).toEqual({ x: 9,  y: 10 });
    expect(poolGet(newHead, 3)).toEqual({ x: 8,  y: 10 });
  });

  it('poolPrepend wraps correctly when headIdx is already at POOL_SIZE - 1', () => {
    // Set headIdx to last slot
    const hi = POOL_SIZE - 1;
    segPool[hi].x = 5; segPool[hi].y = 5;
    const newHead = poolPrepend(hi, 6, 5);
    expect(newHead).toBe(POOL_SIZE - 2);
    expect(segPool[newHead]).toEqual({ x: 6, y: 5 });
  });

  it('consecutive prepends simulate forward snake movement', () => {
    // Start: headIdx=0, seg[0]={10,10}, seg[1]={9,10}, seg[2]={8,10}
    // Move right: prepend {11,10}, "pop" tail by decrementing length
    let hi = 0;
    let len = 3;
    hi = poolPrepend(hi, 11, 10);
    len++;   // prepend added one
    len--;   // tail popped (no food)
    // Length stays 3; head moved right
    expect(len).toBe(3);
    expect(poolGet(hi, 0)).toEqual({ x: 11, y: 10 });
    expect(poolGet(hi, 1)).toEqual({ x: 10, y: 10 });
    expect(poolGet(hi, 2)).toEqual({ x: 9,  y: 10 });
    // {8,10} is still in the pool but outside snakeLen — logically gone
  });

  it('growing (eating food) increases logical length', () => {
    let hi = 0;
    let len = 3;
    hi = poolPrepend(hi, 11, 10);
    len++;  // prepend + no pop = grow by 1
    expect(len).toBe(4);
    expect(poolGet(hi, 0)).toEqual({ x: 11, y: 10 });
    expect(poolGet(hi, 3)).toEqual({ x: 8,  y: 10 });
  });

  it('POOL_SIZE equals COLS * ROWS', () => {
    expect(POOL_SIZE).toBe(COLS * ROWS);
  });
});

// ── Level progression ─────────────────────────────────────────────────────────

describe('levelForScore', () => {
  it('score 0 → level 0 (EASY)', () => {
    expect(levelForScore(0)).toBe(0);
  });

  it('score just below first threshold stays at level 0', () => {
    expect(levelForScore(LEVELS[0].scoreNext - 10)).toBe(0);
  });

  it('score at first threshold advances to level 1', () => {
    expect(levelForScore(LEVELS[0].scoreNext)).toBe(1);
  });

  it('score at second threshold advances to level 2', () => {
    expect(levelForScore(LEVELS[1].scoreNext)).toBe(2);
  });

  it('very high score stays capped at max level', () => {
    expect(levelForScore(999999)).toBe(LEVELS.length - 1);
  });

  it('score at each threshold maps to the correct level', () => {
    LEVELS.forEach((lvl, i) => {
      if (lvl.scoreNext === Infinity) return; // last level, skip
      // Exactly at the threshold: should be at the *next* level
      expect(levelForScore(lvl.scoreNext)).toBe(i + 1);
    });
  });
});
