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
// Speed decays geometrically from BASE_SPEED and is clamped at SPEED_FLOOR,
// so the curve is monotonic and the level-up loop always terminates.
export const BASE_SPEED  = 300;   // level 0 tick interval in ms
export const SPEED_DECAY = 0.9;   // multiplier applied per level

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

// ─── Per-food speed tuning ────────────────────────────────────────────────────
// Each food eaten within a level reduces the tick interval by SPEED_PER_FOOD ms,
// resetting to the new level's base speed on every level-up.
// SPEED_FLOOR is a hard minimum to prevent the interval reaching unusable values.
export const SPEED_PER_FOOD = 8;   // ms subtracted per food eaten within a level
export const SPEED_FLOOR    = 40;  // minimum interval in ms (floor for the whole curve)

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
