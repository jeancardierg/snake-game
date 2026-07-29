// ─── Grid dimensions ──────────────────────────────────────────────────────────
// The board is a COLS × ROWS grid. Each cell is CELL logical pixels square.
// Changing COLS/ROWS resizes the board; changing CELL resizes the visual size.
export const COLS = 10;          // number of columns
export const ROWS = 10;          // number of rows
export const CELL = 20;          // pixels per cell (logical, before devicePixelRatio)

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

// Hard cap on obstacle cells per level. On a 10×10 board this is the practical
// ceiling before layouts start crowding out the growing snake.
// Layouts are built from 4-way mirrored groups, so a multiple of 4 keeps the
// cap actually reachable — at 10 the third group would never fit.
export const MAX_OBSTACLES = 12;

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
