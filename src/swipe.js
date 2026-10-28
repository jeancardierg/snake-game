/**
 * swipe.js — swipe direction from a finger's travel.
 *
 * Pure so it can be unit-tested without touch events.
 */
import { DIR } from './constants';

/**
 * @param {number} dx         finger travel on x since the gesture origin (px)
 * @param {number} dy         finger travel on y since the gesture origin (px)
 * @param {number} threshold  minimum travel on the dominant axis (px)
 * @returns {{x:number,y:number}|null}  a DIR vector, or null below threshold
 */
export function swipeDir(dx, dy, threshold) {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return null;
  // The dominant axis determines direction
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? DIR.RIGHT : DIR.LEFT;
  return dy > 0 ? DIR.DOWN : DIR.UP;
}
