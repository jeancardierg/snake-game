// ─── Grid dimensions ──────────────────────────────────────────────────────────
// The board is a COLS × ROWS grid. Each cell is CELL logical pixels square.
// Changing COLS/ROWS resizes the board; changing CELL resizes the visual size.
export const COLS = 10;          // number of columns
export const ROWS = 10;          // number of rows
export const CELL = 20;          // pixels per cell (logical, before devicePixelRatio)

// ─── Level definitions ────────────────────────────────────────────────────────
// Levels are advanced automatically by useSnake when score crosses scoreNext.
// The final level (INSANE) has scoreNext: Infinity so the player never leaves it.
export const LEVELS = [
  { label: 'EASY',   speed: 200, scoreNext: 50,       color: '#4ecca3' },
  { label: 'MEDIUM', speed: 150, scoreNext: 120,      color: '#a0e060' },
  { label: 'FAST',   speed: 110, scoreNext: 220,      color: '#f0c040' },
  { label: 'HYPER',  speed: 80,  scoreNext: 360,      color: '#f07030' },
  { label: 'INSANE', speed: 55,  scoreNext: Infinity, color: '#e03060' },
  // speed = setInterval delay in ms (lower = faster)
  // color  = snake body color + UI accent for that level
];

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
