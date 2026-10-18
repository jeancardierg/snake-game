/**
 * shadowFit.js — size a directional light's orthographic shadow box so it
 * covers the whole board.
 *
 * The shadow camera looks along the light direction, so its box is tilted
 * relative to the board. Sizing it from the board's half-width alone (as the
 * renderer did, ±HALF+CELL) leaves the corners outside the box, and shadows
 * there are cut off along a diagonal — visible at all four corners.
 *
 * Pure so it can be unit-tested without WebGL.
 */

/**
 * Half-extent the shadow camera needs so every point of the board volume
 * (x, z in [-half, half], y in [0, height]) projects inside its box.
 *
 * @param {number} half      board half-width in world units
 * @param {number} height    tallest thing that casts a shadow (world units)
 * @param {{x:number,y:number,z:number}} lightPos  light position (target at origin)
 * @param {number} [margin]  extra world units around the board
 * @returns {number} half-extent for left/right/top/bottom
 */
export function shadowHalfExtent(half, height, lightPos, margin = 0) {
  const len = Math.hypot(lightPos.x, lightPos.y, lightPos.z) || 1;
  // Unit vector from the light toward its target (the origin).
  const u = { x: -lightPos.x / len, y: -lightPos.y / len, z: -lightPos.z / len };
  let max = 0;
  for (const x of [-half, half]) for (const y of [0, height]) for (const z of [-half, half]) {
    const d = x * u.x + y * u.y + z * u.z;                  // along the light
    const px = x - d * u.x, py = y - d * u.y, pz = z - d * u.z;  // perpendicular to it
    // The camera's local axes are an orthonormal basis of the perpendicular
    // plane; the distance from the axis bounds both box coordinates.
    max = Math.max(max, Math.hypot(px, py, pz));
  }
  return Math.ceil(max + margin);
}
