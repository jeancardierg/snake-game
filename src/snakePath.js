/**
 * snakePath.js — the path the snake's body follows.
 *
 * The body used to be a Catmull-Rom spline refit every frame through segment
 * centres that each slid in a straight line between cells. The spline's shape
 * at a corner depended on where those points were mid-step, so every corner
 * flattened and re-sharpened once per tick and the whole body wiggled.
 *
 * Here the body lies on a fixed path on the ground instead: the polyline
 * through the cells the head has visited, with each corner replaced by a
 * quarter-circle fillet. The renderer samples it by distance behind the head,
 * so a point on the ground keeps its shape as the body slides through it.
 *
 * Layout: vertex k is the k-th segment centre (0 = head cell) at path distance
 * k·CELL from vertex 0. The rendered head sits CELL·(1 − e) along the path,
 * where e is the step's progress, i.e. between vertex 1 and vertex 0.
 *
 * Lateral slither is pinned to the ground the same way (slitherOffset), so
 * the body slides through a still wave instead of swaying as a whole.
 *
 * Pure so it can be unit-tested without WebGL.
 */
import { CELL } from './constants';

/** Fillet radius at a full corner: half a cell, the most a 1-cell U-turn allows. */
export const CORNER_R = CELL / 2;

/**
 * Fillet radius of the corner at vertex k (k ≥ 1). A corner starts sharp when
 * the head turns on it and opens to CORNER_R as the head moves away, so the
 * head is never inside a fillet and stays on its straight grid step.
 * @param {number} k      vertex index
 * @param {number} hDist  path distance of the rendered head from vertex 0
 */
export function cornerRadius(k, hDist) {
  return Math.min(CORNER_R, Math.max(0, k * CELL - hDist));
}

/**
 * Fill vr[0..n-1] with each vertex's fillet radius: cornerRadius() where the
 * path turns, 0 on straight runs and at both ends.
 */
export function filletRadii(vx, vz, vr, n, hDist) {
  vr[0] = 0;
  vr[n - 1] = 0;
  for (let k = 1; k < n - 1; k++) {
    const dot = (vx[k] - vx[k - 1]) * (vx[k + 1] - vx[k]) + (vz[k] - vz[k - 1]) * (vz[k + 1] - vz[k]);
    vr[k] = dot > 0.5 * CELL * CELL ? 0 : cornerRadius(k, hDist);
  }
}

/**
 * Point and unit tangent (pointing toward the tail) at path distance D.
 * @param {Float32Array|number[]} vx  vertex X, world units
 * @param {Float32Array|number[]} vz  vertex Z, world units
 * @param {Float32Array|number[]} vr  fillet radius per vertex (0 = straight / none)
 * @param {number} n    vertex count (≥ 2)
 * @param {number} D    distance from vertex 0
 * @param {{x:number,z:number,tx:number,tz:number}} out  written and returned
 */
export function samplePath(vx, vz, vr, n, D, out) {
  const kv = Math.round(D / CELL);
  if (kv >= 1 && kv < n - 1) {
    const r = vr[kv], off = D - kv * CELL;
    if (r > 0 && Math.abs(off) < r) {
      // Quarter circle tangent to both legs, r before and r after the vertex.
      const ix = (vx[kv] - vx[kv - 1]) / CELL, iz = (vz[kv] - vz[kv - 1]) / CELL;
      const ox = (vx[kv + 1] - vx[kv]) / CELL, oz = (vz[kv + 1] - vz[kv]) / CELL;
      const th = ((off + r) / (2 * r)) * (Math.PI / 2);
      const c = Math.cos(th), s = Math.sin(th);
      const cx = vx[kv] - ix * r + ox * r, cz = vz[kv] - iz * r + oz * r;
      out.x  = cx - ox * r * c + ix * r * s;
      out.z  = cz - oz * r * c + iz * r * s;
      out.tx = ix * c + ox * s;
      out.tz = iz * c + oz * s;
      return out;
    }
  }
  const k = Math.max(0, Math.min(n - 2, Math.floor(D / CELL)));
  const t = D - k * CELL;
  const ux = (vx[k + 1] - vx[k]) / CELL, uz = (vz[k + 1] - vz[k]) / CELL;
  out.x  = vx[k] + ux * t;
  out.z  = vz[k] + uz * t;
  out.tx = ux;
  out.tz = uz;
  return out;
}

// ─── Slither ──────────────────────────────────────────────────────────────────
export const SLITHER_AMP  = 3.25;         // max lateral offset, world units
export const SLITHER_WAVE = CELL * 3.75;  // wavelength along the ground
const SLITHER_RAMP = CELL * 1.5;          // 0 at the head → full amplitude here
const SLITHER_TAIL = 0.15;                // fraction of the body that fades out at the tail

const smoothstep = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/**
 * Lateral offset of the body at `d` units behind the head.
 * @param {number} d        distance behind the head (0 … total)
 * @param {number} total    body length
 * @param {number} headAbs  ground distance the head has travelled; the wave is
 *                          a function of (headAbs − d), a fixed ground position
 */
export function slitherOffset(d, total, headAbs) {
  const s   = total > 0 ? d / total : 0;
  const amp = SLITHER_AMP * smoothstep(d / SLITHER_RAMP) * Math.min(1, (1 - s) / SLITHER_TAIL);
  return amp * Math.sin(((headAbs - d) / SLITHER_WAVE) * Math.PI * 2);
}
