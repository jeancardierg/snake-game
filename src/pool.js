/**
 * pool.js — shared circular ring buffer for snake segments.
 *
 * Pre-allocates POOL_SIZE {x,y} objects once at module load.
 * The game loop mutates these objects in-place — zero per-tick allocation,
 * no garbage collection pressure regardless of snake length or speed.
 *
 * Layout: a circular deque with headIdx pointing to the most-recently
 * added segment (index 0 = head, index length-1 = tail).
 *
 *   poolPrepend(headIdx, x, y) → new headIdx  (O(1), no allocation)
 *   poolGet(headIdx, i)        → segment at logical index i
 *
 * Shrinking (tail pop) is done by simply decrementing snakeLen — the
 * tail slot stays in the pool and will be overwritten on a future prepend.
 */
import { COLS, ROWS } from './constants';

export const POOL_SIZE = COLS * ROWS;  // 400 — maximum possible snake length

// Single contiguous allocation, shared by useSnake (writes) and GameCanvas (reads).
export const segPool = Array.from({ length: POOL_SIZE }, () => ({ x: 0, y: 0 }));

/**
 * Write `segments` (head-first) into the pool starting at index 0.
 * Resets the ring to a known state; use at startup and on reset.
 * Returns the new headIdx (always 0).
 */
export function initPool(segments) {
  for (let i = 0; i < segments.length; i++) {
    segPool[i].x = segments[i].x;
    segPool[i].y = segments[i].y;
  }
  return 0;
}

/**
 * Return the segment at logical index i (0 = head, length-1 = tail).
 */
export function poolGet(headIdx, i) {
  return segPool[(headIdx + i) % POOL_SIZE];
}

/**
 * Prepend a new head segment in-place (no allocation).
 * Mutates segPool at the new slot and returns the updated headIdx.
 */
export function poolPrepend(headIdx, x, y) {
  const next = (headIdx - 1 + POOL_SIZE) % POOL_SIZE;
  segPool[next].x = x;
  segPool[next].y = y;
  return next;
}
