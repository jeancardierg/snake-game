// ─── Grid dimensions ──────────────────────────────────────────────────────────
// The board is a COLS × ROWS grid. Each cell is CELL world units square (the
// on-screen size comes from the responsive layout, not from CELL).
// Spawn, obstacle quadrants, the obstacle budget, the segment pool and the
// renderer all derive from COLS/ROWS, so resizing needs no other edits.
//
// 13×13: odd, so the spawn row is the mirror axis of the 4-way obstacle
// layouts, and still ≥ 21 CSS px per cell on the smallest phone measured
// (iPhone SE, 279 px board). Was 10×10.
export const COLS = 13;          // number of columns
export const ROWS = 13;          // number of rows
export const CELL = 20;          // world units per cell

// ─── Level curve ──────────────────────────────────────────────────────────────
// Levels are generated, not enumerated — see levels.js. Progression is endless
// ("survival"): getLevel(n) is defined for every n, and useSnake advances when
// the score crosses the current level's threshold.
//
// Speed approaches SPEED_FLOOR geometrically: each level keeps SPEED_APPROACH
// of the remaining gap, so the curve is strictly decreasing, never goes below
// the floor, and flattens as it nears it (difficulty past ~L20 comes from walls
// and snake length, not raw speed).
//
// The floor is set by human limits, not by what the code can do. A tick is one
// cell, and a reactive input (food just spawned, a wall just dropped in) lands
// ~350 ms after the event on desktop (choice reaction ~300 ms + input/display
// path) and ~430 ms on phones (touch latency measured at 55–120 ms). At 100 ms
// the snake travels ~3.5 cells (desktop) / ~4.3 cells (touch) before such an
// input lands — hard but humanly playable. The old 40 ms floor (25 moves/s) was
// 8.8 / 10.8 cells, and most turns could not be timed onto the intended cell.
export const BASE_SPEED     = 300;   // level 0 tick interval in ms
export const SPEED_FLOOR    = 100;   // asymptote and hard minimum for the whole curve (ms)
export const SPEED_APPROACH = 0.88;  // fraction of (speed − floor) kept per level

// Foods required to clear a level: FOODS_BASE + n * FOODS_PER_LEVEL, capped.
// Every food is worth 10 points, so this doubles as the score threshold curve.
export const FOODS_BASE      = 5;
export const FOODS_PER_LEVEL = 1.5;
export const FOODS_MAX       = 20;

// Hard cap on obstacle cells per level: ~12% of the board, the density that
// tested as the practical ceiling on 10×10 (12 of 100) before layouts crowd
// out the growing snake. Layouts are built from 4-way mirrored groups, so the
// cap is rounded down to a multiple of 4 to stay reachable. 13×13 → 20.
export const MAX_OBSTACLES = Math.max(4, Math.floor((COLS * ROWS * 0.12) / 4) * 4);

// ─── Per-food speed ramp ──────────────────────────────────────────────────────
// Each food eaten within a level speeds the tick up by a fraction of that
// level's base speed, capped, and resets on every level-up (a breather).
// Relative and capped on purpose: the old flat −8 ms per food with up to 19
// foods per level could take a level from 177 ms to the 40 ms floor before it
// ended (L06), which no human can track.
export const SPEED_RAMP_PER_FOOD = 0.015;  // 1.5% faster per food this level
export const SPEED_RAMP_MAX      = 0.15;   // at most 15% faster than the level's base

// ─── Input constants ──────────────────────────────────────────────────────────
// Minimum pixel travel for a touch to register as a directional swipe.
export const SWIPE_THRESHOLD = 20;
// Maximum number of buffered direction changes before new inputs are dropped.
// Keeps the queue bounded; two buffered turns is enough for any legitimate play.
export const DIR_QUEUE_MAX = 2;

// ─── Direction vectors ────────────────────────────────────────────────────────
// Convenience constants; not used by the core loop (which stores {x,y} inline)
// but available for tests, extensions, or clarity.
export const DIR = {
  UP:    { x: 0,  y: -1 },  // y decreases going up (canvas origin is top-left)
  DOWN:  { x: 0,  y: 1  },
  LEFT:  { x: -1, y: 0  },
  RIGHT: { x: 1,  y: 0  },
};
