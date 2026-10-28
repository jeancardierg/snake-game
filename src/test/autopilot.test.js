/**
 * Tests for autopilot.js — single-move choices plus whole-game simulations on
 * the real level layouts, in classic and wrap mode.
 */
import { describe, it, expect } from 'vitest';
import { autopilotDir } from '../autopilot';
import { COLS, ROWS } from '../constants';
import { getLevel, mulberry32, SPAWN_ROW, SPAWN_HEAD_X } from '../levels';

const key = (c) => c.x * ROWS + c.y;
const RIGHT = { x: 1, y: 0 };
const NONE = new Set();

describe('autopilotDir — single moves', () => {
  it('heads for the food', () => {
    const body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    expect(autopilotDir({ body, dir: RIGHT, food: { x: 5, y: 2 }, obstacles: NONE, wrap: false }))
      .toEqual({ x: 0, y: -1 });
  });

  it('never drives off a walled board', () => {
    const body = [{ x: COLS - 1, y: 5 }, { x: COLS - 2, y: 5 }, { x: COLS - 3, y: 5 }];
    const d = autopilotDir({ body, dir: RIGHT, food: { x: 0, y: 5 }, obstacles: NONE, wrap: false });
    expect(d.x).toBe(0);
  });

  it('takes the short way through the edge in wrap mode', () => {
    const body = [{ x: COLS - 1, y: 5 }, { x: COLS - 2, y: 5 }, { x: COLS - 3, y: 5 }];
    expect(autopilotDir({ body, dir: RIGHT, food: { x: 0, y: 5 }, obstacles: NONE, wrap: true }))
      .toEqual(RIGHT);
  });

  it('steers around an obstacle', () => {
    const body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    const obstacles = new Set([key({ x: 6, y: 5 })]);
    const d = autopilotDir({ body, dir: RIGHT, food: { x: 8, y: 5 }, obstacles, wrap: false });
    expect(d).not.toEqual(RIGHT);
    expect(d.x).toBe(0);
  });

  it('never reverses into its own neck', () => {
    const body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    const d = autopilotDir({ body, dir: RIGHT, food: { x: 0, y: 5 }, obstacles: NONE, wrap: false });
    expect(d).not.toEqual({ x: -1, y: 0 });
  });
});

/** True when at least one neighbour of the head is safe to enter this tick. */
function hasLegalMove(body, obstacles, wrap) {
  const tail = body[body.length - 1];
  return [RIGHT, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].some((d) => {
    let x = body[0].x + d.x;
    let y = body[0].y + d.y;
    if (wrap) { x = (x + COLS) % COLS; y = (y + ROWS) % ROWS; }
    else if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    if (obstacles.has(x * ROWS + y)) return false;
    return !body.some((s) => s.x === x && s.y === y && s !== tail);
  });
}

/** Play a whole game with the autopilot; returns foods eaten and how it ended. */
function simulate({ wrap, seed, maxTicks = 4000 }) {
  const rng = mulberry32(seed);
  let body = [0, 1, 2].map((i) => ({ x: SPAWN_HEAD_X - i, y: SPAWN_ROW }));
  let dir = RIGHT;
  let level = 0;
  let eaten = 0;
  let foodsThisLevel = 0;
  let obstacles = new Set(getLevel(0).obstacles.map(key));
  const placeFood = () => {
    const taken = new Set([...obstacles, ...body.map(key)]);
    const free = [];
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if (!taken.has(x * ROWS + y)) free.push({ x, y });
    return free.length ? free[Math.floor(rng() * free.length)] : null;
  };
  let food = placeFood();
  for (let t = 0; t < maxTicks; t++) {
    if (!hasLegalMove(body, obstacles, wrap)) return { eaten, died: 'trapped' };
    dir = autopilotDir({ body, dir, food, obstacles, wrap });
    let hx = body[0].x + dir.x;
    let hy = body[0].y + dir.y;
    if (wrap) { hx = (hx + COLS) % COLS; hy = (hy + ROWS) % ROWS; }
    else if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS) return { eaten, died: 'wall' };
    if (obstacles.has(hx * ROWS + hy)) return { eaten, died: 'obstacle' };
    const eat = hx === food.x && hy === food.y;
    const check = eat ? body : body.slice(0, -1);
    if (check.some((s) => s.x === hx && s.y === hy)) return { eaten, died: 'self' };
    body = [{ x: hx, y: hy }, ...body];
    if (!eat) { body.pop(); continue; }
    eaten++;
    foodsThisLevel++;
    if (foodsThisLevel >= 5 + level) {
      // New layout, minus any cell under the snake (useSnake defers those).
      level++;
      foodsThisLevel = 0;
      // Like useSnake, never drop a wall under the snake or near the head.
      const h = body[0];
      const near = (c) => {
        const dx = Math.min(Math.abs(c.x - h.x), wrap ? COLS - Math.abs(c.x - h.x) : COLS);
        const dy = Math.min(Math.abs(c.y - h.y), wrap ? ROWS - Math.abs(c.y - h.y) : ROWS);
        return dx + dy <= 2;
      };
      const under = new Set(body.map(key));
      obstacles = new Set(getLevel(level).obstacles.filter((c) => !near(c) && !under.has(key(c))).map(key));
    }
    food = placeFood();
    if (!food) return { eaten, died: null };
  }
  return { eaten, died: null };
}

describe('autopilotDir — whole games', () => {
  // Deaths only when a level-up wall boxes the snake in with no legal move
  // left; the autopilot itself never steers into a wall, obstacle or its body.
  for (const wrap of [false, true]) {
    it(`only dies when boxed in, and eats plenty (${wrap ? 'wrap' : 'classic'})`, () => {
      const runs = Array.from({ length: 4 }, (_, i) => simulate({ wrap, seed: 1000 + i, maxTicks: 1500 }));
      for (const r of runs) expect([null, 'trapped']).toContain(r.died);
      const mean = runs.reduce((a, r) => a + r.eaten, 0) / runs.length;
      expect(mean).toBeGreaterThan(40);
    }, 30000);
  }
});
