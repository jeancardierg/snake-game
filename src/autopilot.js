/**
 * autopilot.js — picks the snake's next move when Autopilot is on.
 *
 * Works on the grid, not the camera, so it behaves the same in every view
 * (Chase cam included). Pure: takes the board, returns a direction.
 *
 * Strategy (cheap on a 13×13 board — a few BFS passes per tick):
 *   1. Shortest path to the food, if after eating it the head can still reach
 *      its own tail (a snake that can follow its tail cannot be trapped).
 *   2. Otherwise the move that keeps the tail reachable by the longest route,
 *      to stall safely until the food path opens up.
 *   3. Otherwise the move with the most room left (flood fill).
 *   4. No legal move: keep going (the crash is unavoidable).
 *
 * Body cells free up over time: segment i (0 = head) of an n-long snake has
 * left its cell after n − i moves, so the search lets the head enter a cell
 * once it has been vacated rather than treating the whole body as a wall.
 */
import { COLS, ROWS } from './constants';

const MOVES = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

const keyOf = (x, y) => x * ROWS + y;

/** Neighbour cell of (x,y) along `d`, or null when it leaves a walled board. */
function step(x, y, d, wrap) {
  let nx = x + d.x;
  let ny = y + d.y;
  if (wrap) {
    nx = (nx + COLS) % COLS;
    ny = (ny + ROWS) % ROWS;
  } else if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
    return null;
  }
  return { x: nx, y: ny };
}

/** Map cell key → number of moves until that body cell is vacated. */
function freeTimes(body) {
  const free = new Map();
  const n = body.length;
  for (let i = 0; i < n; i++) free.set(keyOf(body[i].x, body[i].y), n - i);
  return free;
}

/**
 * Time-aware BFS from body[0]. Returns { dist, prev } keyed by cell, where
 * prev holds the cell key the head came from (−1 for the start).
 */
function search(body, obstacles, wrap, moves = MOVES) {
  const free = freeTimes(body);
  const start = keyOf(body[0].x, body[0].y);
  const dist = new Map([[start, 0]]);
  const prev = new Map([[start, -1]]);
  const queue = [body[0]];
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    const t = dist.get(keyOf(c.x, c.y)) + 1;
    for (const d of moves) {
      const n = step(c.x, c.y, d, wrap);
      if (!n) continue;
      const k = keyOf(n.x, n.y);
      if (dist.has(k) || obstacles.has(k) || (free.get(k) ?? 0) > t) continue;
      dist.set(k, t);
      prev.set(k, keyOf(c.x, c.y));
      queue.push(n);
    }
  }
  return { dist, prev };
}

/** Body after the head moves through `path` (cells, first step first). */
function advance(body, path, grow) {
  const next = [...path].reverse().concat(body);
  next.length = body.length + (grow ? 1 : 0);
  return next;
}

/** Moves from the head to its tail in `body`, or −1 when it is cut off. */
function tailDistance(body, obstacles, wrap) {
  const tail = body[body.length - 1];
  return search(body, obstacles, wrap).dist.get(keyOf(tail.x, tail.y)) ?? -1;
}

/**
 * Next direction for the snake.
 *
 *   body      {x,y}[] head first
 *   dir       {x,y}   current heading (tried first, so ties don't wiggle)
 *   food      {x,y}
 *   obstacles Set<number> of x*ROWS+y keys
 *   wrap      boolean
 */
export function autopilotDir({ body, dir, food, obstacles, wrap }) {
  const head = body[0];
  // Current heading first, then the rest, so equal options keep it straight.
  const moves = [dir, ...MOVES.filter((m) => m.x !== dir.x || m.y !== dir.y)];
  const foodKey = keyOf(food.x, food.y);

  // 1. Shortest safe path to the food.
  const { dist, prev } = search(body, obstacles, wrap, moves);
  if (dist.has(foodKey)) {
    const path = [];
    for (let k = foodKey; prev.get(k) !== -1; k = prev.get(k)) {
      path.push({ x: Math.floor(k / ROWS), y: k % ROWS });
    }
    path.reverse();
    const after = advance(body, path, true);
    if (tailDistance(after, obstacles, wrap) > 0) return dirTo(head, path[0], moves, wrap);
  }

  // 2 & 3. One step at a time: keep the tail reachable, else the most room.
  const free = freeTimes(body);
  let best = null;
  for (const m of moves) {
    const n = step(head.x, head.y, m, wrap);
    if (!n) continue;
    const k = keyOf(n.x, n.y);
    if (obstacles.has(k) || (free.get(k) ?? 0) > 1) continue;
    const after = advance(body, [n], k === foodKey);
    const tail = tailDistance(after, obstacles, wrap);
    const room = search(after, obstacles, wrap).dist.size;
    const rank = tail > 0 ? 1e6 + tail * 1e3 + room : room;
    if (!best || rank > best.rank) best = { m, rank };
  }
  return best ? best.m : dir;
}

/** Direction (from `moves`) that takes `from` to the adjacent cell `to`. */
function dirTo(from, to, moves, wrap) {
  for (const m of moves) {
    const n = step(from.x, from.y, m, wrap);
    if (n && n.x === to.x && n.y === to.y) return m;
  }
  return moves[0];
}
