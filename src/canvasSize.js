/**
 * canvasSize.js — drawing-buffer sizing for the WebGL board.
 *
 * The canvas is laid out by CSS (width/height 100% of a square container), so
 * its on-screen size varies with the viewport. The drawing buffer must follow
 * that size, multiplied by the device pixel ratio, or the browser upscales a
 * small buffer and the board looks soft. (Previously the buffer was a fixed
 * 200×200 logical px: on a 1080p monitor it was stretched ~1.9× to 388 px.)
 *
 * Pure so it can be unit-tested without WebGL.
 */

/**
 * Cap on the pixel ratio. 3× phones gain nothing visible over 2× at this
 * scale, while the fill cost grows with the square of the ratio.
 */
export const MAX_PIXEL_RATIO = 2;

/**
 * @param {number} cssW  canvas clientWidth  (CSS px)
 * @param {number} cssH  canvas clientHeight (CSS px)
 * @param {number} dpr   window.devicePixelRatio
 * @returns {{ width:number, height:number, pixelRatio:number,
 *             viewport:{ x:number, y:number, size:number } }}
 *   width/height/viewport are in CSS px — three.js applies pixelRatio itself.
 *   The viewport is the largest centred square: the camera frustum is exactly
 *   the board, so a non-square canvas is letterboxed instead of stretched.
 */
export function computeCanvasSize(cssW, cssH, dpr) {
  const width  = Math.max(1, Math.round(Number.isFinite(cssW) ? cssW : 0));
  const height = Math.max(1, Math.round(Number.isFinite(cssH) ? cssH : 0));
  const ratio  = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const pixelRatio = Math.min(ratio, MAX_PIXEL_RATIO);
  const size = Math.min(width, height);
  return {
    width,
    height,
    pixelRatio,
    viewport: { x: (width - size) / 2, y: (height - size) / 2, size },
  };
}
