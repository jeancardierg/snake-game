/**
 * levels.js — deterministic infinite level generator.
 *
 * Replaces the former fixed LEVELS array in constants.js. Level N is derived
 * entirely from N: the same index yields the same speed, theme, music and
 * obstacle layout on every machine and every run. Math.random() is deliberately
 * not used here — layouts must be reproducible so they can be tested.
 *
 * Progression is unbounded ("survival"): there is no final level. The three
 * curves below (foods, score threshold, speed) are monotonic, so the level-up
 * loop in useSnake always terminates.
 *
 * The first THEMES.length levels reuse the original difficulty tier names
 * (EASY … INSANE) as their identifiers, so the opening of the game reads as
 * before. Past that, themes cycle with a hue rotation and a numeral suffix
 * so level 13 is visibly distinct from level 3.
 */
import {
  COLS, ROWS,
  BASE_SPEED, SPEED_DECAY, SPEED_FLOOR,
  FOODS_BASE, FOODS_PER_LEVEL, FOODS_MAX,
  MAX_OBSTACLES,
} from './constants';

// ─── PRNG ─────────────────────────────────────────────────────────────────────
// mulberry32: 32-bit, seedable, ~2^32 period. Enough for layout selection and
// melody variation, and avoids adding a dependency.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Spawn safety ─────────────────────────────────────────────────────────────
// INIT_SNAKE in useSnake.js is (5,5),(4,5),(3,5) heading right. Obstacles must
// never occupy those cells or the runway ahead of the head, or the player would
// die before pressing a key. Kept in sync with useSnake.js INIT_SNAKE.
export const SPAWN_ROW      = 5;
export const SPAWN_RUNWAY_X = 7;   // reserve x = 0..7 on SPAWN_ROW

function isReserved(x, y) {
  return y === SPAWN_ROW && x <= SPAWN_RUNWAY_X;
}

const cellKey = (x, y) => x * ROWS + y;

// ─── Difficulty curves ────────────────────────────────────────────────────────

/** Foods required to clear level n. Rises linearly, then plateaus at FOODS_MAX. */
export function foodsForLevel(n) {
  return Math.min(FOODS_MAX, FOODS_BASE + Math.floor(n * FOODS_PER_LEVEL));
}

// Cumulative score thresholds, filled lazily and kept forever (one number per
// level reached — negligible). Each food is worth 10 points, so "eat N foods to
// clear the level" and "cross score threshold T" are the same mechanism; this
// lets useSnake keep its existing threshold-driven level-up code.
const thresholds = [];

/** Score at which level n ends and level n+1 begins. Strictly increasing. */
export function scoreNextFor(n) {
  for (let i = thresholds.length; i <= n; i++) {
    thresholds[i] = (i === 0 ? 0 : thresholds[i - 1]) + foodsForLevel(i) * 10;
  }
  return thresholds[n];
}

/** Tick interval in ms for level n. Decays geometrically, floored. */
export function speedForLevel(n) {
  return Math.max(SPEED_FLOOR, Math.round(BASE_SPEED * Math.pow(SPEED_DECAY, n)));
}

// ─── Color helpers ────────────────────────────────────────────────────────────
// Themes past the first cycle are the base theme with every color hue-rotated
// by a fixed step, which keeps each palette internally consistent (relative hue
// distances are preserved) while making the cycle read as a new world.

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hueToRgb(p, q, t) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

/** Rotate the hue of a 0xRRGGBB integer by `deg` degrees. */
function shiftHue(hex, deg) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const [h, s, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb((h + deg / 360 + 1) % 1, s, l);
  return (Math.round(nr * 255) << 16) | (Math.round(ng * 255) << 8) | Math.round(nb * 255);
}

/** Rotate the hue of a '#rrggbb' string by `deg` degrees, returning the same form. */
function shiftHueCss(css, deg) {
  const n = shiftHue(parseInt(css.slice(1), 16), deg);
  return '#' + n.toString(16).padStart(6, '0');
}

// ─── Themes ───────────────────────────────────────────────────────────────────
// Colors are three.js hex integers except `accent`, a CSS string used by the DOM
// chrome (Scoreboard, LevelBar, Overlay, DPad). `label` is the display name.
//
// music: root is a MIDI note number, scale keys into SCALES in music.js.
export const THEMES = [
  {
    label: 'EASY',
    accent: '#4ecca3',
    bg: 0x2f5e22, ground: 0x4a9d3f, grid: 0x2c5518, obstacle: 0x6b4a2a,
    ambient: 0xfff6ec, sun: 0xfff4e0, fill: 0x6688aa, food: 0x1a1a1a,
    music: { root: 57, scale: 'major',      wave: 'square',   bpm: 96 },
  },
  {
    label: 'MEDIUM',
    accent: '#a0e060',
    bg: 0x27461c, ground: 0x6aa83a, grid: 0x33591f, obstacle: 0x7a5c33,
    ambient: 0xf6ffe8, sun: 0xfff8d8, fill: 0x77aa88, food: 0x1a1a1a,
    music: { root: 59, scale: 'major',      wave: 'square',   bpm: 102 },
  },
  {
    label: 'FAST',
    accent: '#f0c040',
    bg: 0x5a4a1c, ground: 0xc2a24e, grid: 0x6b5520, obstacle: 0x8a6a28,
    ambient: 0xfff4dc, sun: 0xffe8b0, fill: 0xaa9966, food: 0x1a1a1a,
    music: { root: 60, scale: 'mixolydian', wave: 'square',   bpm: 108 },
  },
  {
    label: 'HYPER',
    accent: '#f07030',
    bg: 0x3d1a0c, ground: 0x8a3a18, grid: 0x5e2410, obstacle: 0x2a1208,
    ambient: 0xffe0cc, sun: 0xffb070, fill: 0xaa5533, food: 0x141414,
    music: { root: 55, scale: 'minor',      wave: 'square',   bpm: 116 },
  },
  {
    label: 'INSANE',
    accent: '#e03060',
    bg: 0x2a0812, ground: 0x6e1030, grid: 0x45081c, obstacle: 0x1a0410,
    ambient: 0xffd8e4, sun: 0xff7098, fill: 0x8844aa, food: 0x101010,
    music: { root: 53, scale: 'phrygian',   wave: 'sawtooth', bpm: 124 },
  },
  {
    label: 'GLACIER',
    accent: '#5ad2f0',
    bg: 0x122a3a, ground: 0x4a8ba8, grid: 0x1e4258, obstacle: 0xa8d8e8,
    ambient: 0xe8f8ff, sun: 0xd0eeff, fill: 0x5588cc, food: 0x18242c,
    music: { root: 62, scale: 'pentatonic', wave: 'triangle', bpm: 92 },
  },
  {
    label: 'NEBULA',
    accent: '#b070f0',
    bg: 0x180a30, ground: 0x3e2068, grid: 0x281046, obstacle: 0x6a3aa8,
    ambient: 0xe8dcff, sun: 0xc0a0ff, fill: 0x5f4a99, food: 0x0e0818,
    music: { root: 58, scale: 'minor',      wave: 'triangle', bpm: 100 },
  },
  {
    label: 'CIRCUIT',
    accent: '#30e0c0',
    bg: 0x08201e, ground: 0x134540, grid: 0x1f7a6e, obstacle: 0x0c2f2b,
    ambient: 0xdcfff8, sun: 0xa8fff0, fill: 0x338877, food: 0x061412,
    music: { root: 64, scale: 'pentatonic', wave: 'square',   bpm: 118 },
  },
  {
    label: 'EMBERFALL',
    accent: '#ff8c42',
    bg: 0x241410, ground: 0x5c3020, grid: 0x7a4028, obstacle: 0x120a08,
    ambient: 0xffe8d0, sun: 0xffab68, fill: 0x996644, food: 0x0f0806,
    music: { root: 56, scale: 'mixolydian', wave: 'sawtooth', bpm: 110 },
  },
  {
    label: 'MONOLITH',
    accent: '#c0c8d0',
    bg: 0x14181c, ground: 0x3a4148, grid: 0x545c66, obstacle: 0x0a0d10,
    ambient: 0xeef2f6, sun: 0xdde4ec, fill: 0x667788, food: 0x080a0c,
    music: { root: 50, scale: 'minor',      wave: 'square',   bpm: 128 },
  },
];

const HUE_STEP = 37;   // degrees rotated per completed theme cycle

const NUMERALS = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function numeral(cycle) {
  // cycle 0 → no suffix; cycle 1 → 'II'; beyond the table, fall back to digits.
  if (cycle === 0) return '';
  const idx = cycle + 1;
  return ' ' + (NUMERALS[idx] ?? String(idx));
}

// ─── Obstacle generation ──────────────────────────────────────────────────────
// Layouts are built from 4-way mirrored groups so they read as designed rather
// than as noise. A group is added only if it fits entirely within the target
// cell budget and touches no reserved cell — partial groups would break the
// symmetry that makes the layouts legible.

const PATTERNS = ['pillars', 'corners', 'cross', 'diagonal', 'ring'];

// Base cells live in the top-left quadrant, one cell in from the border, and are
// mirrored across both axes. Interior-only keeps layouts off the outer wall,
// where they would otherwise read as a thicker board edge.
const QX = [1, Math.floor(COLS / 2) - 1];
const QY = [1, Math.floor(ROWS / 2) - 1];

function baseCellsFor(pattern, rng) {
  const jx = () => QX[0] + Math.floor(rng() * (QX[1] - QX[0] + 1));
  const jy = () => QY[0] + Math.floor(rng() * (QY[1] - QY[0] + 1));

  switch (pattern) {
    case 'corners':
      return [{ x: QX[0] + 1, y: QY[0] + 1 }, { x: QX[0] + 2, y: QY[0] + 1 }];
    case 'cross':
      return [{ x: Math.floor(COLS / 2) - 1, y: jy() }, { x: jx(), y: Math.floor(ROWS / 2) - 1 }];
    case 'diagonal':
      return [{ x: QX[0] + 1, y: QY[0] + 1 }, { x: QX[0] + 2, y: QY[0] + 2 }, { x: QX[0] + 3, y: QY[0] + 3 }];
    case 'ring':
      return [{ x: QX[0] + 2, y: QY[0] }, { x: QX[0], y: QY[0] + 2 }, { x: QX[0] + 1, y: QY[0] + 1 }];
    case 'pillars':
    default:
      return [{ x: jx(), y: jy() }, { x: jx(), y: jy() }, { x: jx(), y: jy() }];
  }
}

/** The 4-way mirror group of a base cell, deduplicated. */
function mirrorGroup(x, y) {
  const mx = COLS - 1 - x;
  const my = ROWS - 1 - y;
  const seen = new Set();
  const out = [];
  for (const [cx, cy] of [[x, y], [mx, y], [x, my], [mx, my]]) {
    const k = cellKey(cx, cy);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x: cx, y: cy });
  }
  return out;
}

/**
 * Flood-fill from the spawn head over non-obstacle cells.
 * Returns true when every free cell is reachable.
 *
 * This is the critical guard: an unreachable pocket lets randomFood spawn food
 * the player can never eat, which soft-locks the level.
 */
export function isReachable(obstacles) {
  const blocked = new Set(obstacles.map(o => cellKey(o.x, o.y)));
  const total   = COLS * ROWS - blocked.size;
  const seen    = new Set();
  const stack   = [{ x: 5, y: SPAWN_ROW }];
  seen.add(cellKey(5, SPAWN_ROW));

  while (stack.length) {
    const { x, y } = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const k = cellKey(nx, ny);
      if (blocked.has(k) || seen.has(k)) continue;
      seen.add(k);
      stack.push({ x: nx, y: ny });
    }
  }
  return seen.size === total;
}

/**
 * Build the obstacle layout for level n.
 * Always returns a reachable layout — falling back to an empty board if the
 * generated pattern cannot be made valid within MAX_ATTEMPTS.
 */
export function generateObstacles(n, rng) {
  const target = Math.min(MAX_OBSTACLES, Math.floor(n * 1.2));
  if (target <= 0) return [];

  const pattern = PATTERNS[Math.floor(rng() * PATTERNS.length)];
  const groups  = [];
  const used    = new Set();

  for (const base of baseCellsFor(pattern, rng)) {
    const group = mirrorGroup(base.x, base.y);
    // Reject the whole group if any member is reserved or already placed —
    // taking only part of it would break the mirror symmetry.
    if (group.some(c => isReserved(c.x, c.y) || used.has(cellKey(c.x, c.y)))) continue;
    if (used.size + group.length > target) continue;
    for (const c of group) used.add(cellKey(c.x, c.y));
    groups.push(group);
  }

  // Validate, dropping the last group on failure until the layout opens up.
  const MAX_ATTEMPTS = 8;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && groups.length > 0; attempt++) {
    const cells = groups.flat();
    if (isReachable(cells)) return cells;
    groups.pop();
  }
  return [];
}

// ─── Level descriptors ────────────────────────────────────────────────────────

const cache = new Map();

function buildLevel(n) {
  const cycle = Math.floor(n / THEMES.length);
  const base  = THEMES[n % THEMES.length];
  const deg   = cycle * HUE_STEP;

  const theme = cycle === 0
    ? { bg: base.bg, ground: base.ground, grid: base.grid, obstacle: base.obstacle,
        ambient: base.ambient, sun: base.sun, fill: base.fill, food: base.food }
    : { bg: shiftHue(base.bg, deg), ground: shiftHue(base.ground, deg),
        grid: shiftHue(base.grid, deg), obstacle: shiftHue(base.obstacle, deg),
        ambient: base.ambient, sun: base.sun,      // light tints stay neutral
        fill: shiftHue(base.fill, deg), food: base.food };

  const label   = base.label + numeral(cycle);
  const display = String(n + 1).padStart(2, '0');

  // Offset the seed so consecutive levels do not produce correlated first draws.
  const rng = mulberry32(n * 2654435761 + 0x9e3779b9);

  return {
    index: n,
    id:    `L${display}`,
    label,
    title: `LEVEL ${display} · ${label}`,
    speed:     speedForLevel(n),
    scoreNext: scoreNextFor(n),
    foods:     foodsForLevel(n),
    color:     cycle === 0 ? base.accent : shiftHueCss(base.accent, deg),
    theme,
    music: {
      ...base.music,
      bpm:  Math.min(180, base.music.bpm + n * 2),
      seed: n,
    },
    obstacles: generateObstacles(n, rng),
  };
}

/**
 * Level descriptor for index n (0-based). Memoized — this is called from five
 * components on every render.
 */
export function getLevel(n) {
  const idx = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  let level = cache.get(idx);
  if (!level) {
    // Bound the cache in case a very long survival run walks far up the index.
    if (cache.size > 512) cache.clear();
    level = buildLevel(idx);
    cache.set(idx, level);
  }
  return level;
}
