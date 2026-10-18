/**
 * snakeProfile.js — cross-section of the snake body near the head.
 *
 * The body is a tube whose centreline starts at the head's centre. It used to
 * start at full body thickness right there, but the head is a flattened,
 * elongated ellipsoid that is LOWER than the tube: the tube's top (13.6 units)
 * cleared the head's top (12.4) and the back half of the head was overdrawn by
 * the yellow collar ring — the head read as a separate piece stuck on the body.
 *
 * Real snakes have a neck narrower than the head. The profile below starts the
 * tube thin and low, fully inside the head, and widens it to body thickness
 * over NECK_LEN, so the body emerges from under the back of the head.
 *
 * Pure so it can be unit-tested without WebGL.
 */
import { CELL } from './constants';

export const BODY_R   = CELL * 0.34;   // full tube radius
export const HEAD_R   = CELL * 0.44;   // head sphere radius before scaling
export const HEAD_SCALE = { x: 0.9, y: 0.66, z: 1.35 };   // slim, flat, long snout (−Z forward)
export const HEAD_Y   = HEAD_R * 0.75;  // head centre height

/** Neck radius at the head centre — kept inside the head ellipsoid. */
export const NECK_R   = BODY_R * 0.62;
/** Distance behind the head centre over which the neck widens to BODY_R. */
export const NECK_LEN = CELL * 1.1;

const smoothstep = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/**
 * Tube cross-section at `dist` world units behind the head centre.
 * @param {number} dist     distance along the body from the head centre (≥ 0)
 * @param {number} bodyR    radius the body would have here without the neck
 *                          (already includes the head→tail taper)
 * @returns {{ r: number, y: number }} radius and centreline height; the tube
 *          rests on the ground (y = r) everywhere along the neck.
 */
export function neckProfile(dist, bodyR = BODY_R) {
  const t = smoothstep(dist / NECK_LEN);
  const r = NECK_R + (bodyR - NECK_R) * t;
  return { r, y: r };
}

/**
 * Head ellipsoid half-extents (world units) at `dist` behind its centre, or
 * null past its back. Used by tests to check the neck stays inside the head.
 */
export function headSectionAt(dist) {
  const a = HEAD_R * HEAD_SCALE.z;                  // half-length
  if (dist >= a) return null;
  const k = Math.sqrt(1 - (dist / a) ** 2);
  return { halfWidth: HEAD_R * HEAD_SCALE.x * k, top: HEAD_Y + HEAD_R * HEAD_SCALE.y * k, bottom: HEAD_Y - HEAD_R * HEAD_SCALE.y * k };
}

/**
 * Distance behind the head centre where the neck first rises out of the head
 * ellipsoid (≈ 9 units with the defaults). The body's colour bands are offset
 * so the yellow collar starts here, right where the body becomes visible.
 */
export const NECK_EXIT = (() => {
  for (let d = 0; d < CELL * 2; d += 0.1) {
    const h = headSectionAt(d), n = neckProfile(d);
    if (!h || n.y + n.r > h.top || n.r > h.halfWidth) return Math.round(d * 10) / 10;
  }
  return CELL;
})();
