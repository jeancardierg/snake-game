/**
 * logic.js — pure, side-effect-free game rules.
 *
 * Extracted so the tick loop (useSnake.js) and the test suite exercise the
 * SAME code. Previously the tests re-implemented these rules inline, which
 * meant they could stay green while the shipped logic regressed.
 *
 * Every function here is pure: no refs, no module state, no DOM.
 */
import { COLS, ROWS, LEVELS } from './constants';

/** True if `next` is a 180° reversal of `cur` (symmetric). */
export function isReversal(cur, next) {
  return next.x === -cur.x && next.y === -cur.y;
}

/** True if two direction vectors are identical. */
export function isSameDir(a, b) {
  return a.x === b.x && a.y === b.y;
}

/** Head cell after moving one step in `dir`. */
export function nextHead(head, dir) {
  return { x: head.x + dir.x, y: head.y + dir.y };
}

/** True if (x, y) lies outside the board. */
export function isWall(x, y) {
  return x < 0 || x >= COLS || y < 0 || y >= ROWS;
}

/**
 * Level index for a given score.
 * Starts from 0 and climbs; because thresholds are strictly increasing this
 * yields the same result as climbing from the current level, and it correctly
 * jumps past multiple thresholds crossed in a single eat.
 */
export function levelForScore(score) {
  let lvl = 0;
  while (lvl < LEVELS.length - 1 && score >= LEVELS[lvl].scoreNext) lvl++;
  return lvl;
}
