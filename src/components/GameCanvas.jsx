/**
 * GameCanvas — HTML5 Canvas renderer for the snake board.
 *
 * Draws three layers on every animation frame:
 *   1. Background + grid  (blit from offscreen cache — drawn only once ever)
 *   2. Food               (pre-baked radial-gradient glow + solid circle)
 *   3. Snake              (rounded rectangles, head glow sprite, body fades toward tail)
 *
 * Rendering is driven by a requestAnimationFrame loop that reads game state
 * directly from refs (headIdxRef, snakeLenRef, foodRef) — bypassing React
 * reconciliation entirely. The loop runs at ~60 fps independent of the game
 * tick rate, so the canvas always shows the freshest available state.
 *
 * Glow effects:
 *   ctx.shadowBlur (Gaussian blur) has been replaced with pre-rendered offscreen
 *   canvases using radial gradients.  Each unique (color, radius, glowSize) combo
 *   is built once and cached; subsequent frames pay only a Map lookup + drawImage.
 *
 * Retina / high-DPI:
 *   The canvas physical pixel size = SIZE × devicePixelRatio.
 *   The 2D context is scaled by the same ratio so all draw coordinates stay
 *   in logical pixels. Glow sprites are also sized at dpr resolution so they
 *   blit 1:1 to physical pixels via the context transform.
 *   Result: crisp rendering on 2×/3× screens without changing any draw code.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { COLS, ROWS, CELL, LEVELS } from '../constants';
import { segPool, POOL_SIZE } from '../pool';

const SIZE = COLS * CELL;  // logical canvas size in pixels (400 × 400 at default settings)

// ─── Offscreen grid cache ─────────────────────────────────────────────────────
// Static background + grid lines drawn once; blitted each frame as one drawImage.
// Keyed by devicePixelRatio — rebuilt automatically on display DPI change.
let gridCache    = null;
let gridCacheDpr = 0;

function getGridCanvas() {
  const dpr = window.devicePixelRatio || 1;
  if (gridCache && gridCacheDpr === dpr) return gridCache;

  const offscreen = document.createElement('canvas');
  offscreen.width  = SIZE * dpr;
  offscreen.height = SIZE * dpr;

  const ctx = offscreen.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth   = 0.5;
  ctx.beginPath();
  for (let i = 0; i <= COLS; i++) {
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, SIZE);
  }
  for (let j = 0; j <= ROWS; j++) {
    ctx.moveTo(0, j * CELL);
    ctx.lineTo(SIZE, j * CELL);
  }
  ctx.stroke();

  gridCacheDpr = dpr;
  gridCache    = offscreen;
  return offscreen;
}

// ─── Glow sprite cache ────────────────────────────────────────────────────────
// Each entry is an offscreen canvas with a radial gradient simulating the glow
// that ctx.shadowBlur would have produced.  Keyed by "color:radius:glowSize:dpr"
// so the sprite is crisp on every screen density and rebuilds on level-up.
const glowCache = new Map();

/**
 * Build (or return cached) a square offscreen canvas containing a radial-gradient
 * glow centered at (total, total) where total = radius + glowSize.
 *
 * The canvas dimensions are (total*2) × dpr physical pixels, matching the logical
 * size of total*2 after the main context's DPR transform — so drawImage blits 1:1.
 */
function buildGlowSprite(color, radius, glowSize) {
  const dpr   = window.devicePixelRatio || 1;
  const key   = `${color}:${radius}:${glowSize}:${dpr}`;
  if (glowCache.has(key)) return glowCache.get(key);

  const total   = radius + glowSize;         // half the logical sprite size
  const logical = total * 2;                 // full logical size
  const off     = document.createElement('canvas');
  off.width     = logical * dpr;             // physical pixels = logical × dpr
  off.height    = logical * dpr;
  const cx      = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);                        // draw in logical coordinates

  const grad = cx.createRadialGradient(total, total, 0, total, total, total);
  grad.addColorStop(0,              color + 'cc');  // ~80% at center
  grad.addColorStop(radius / total, color + '44');  // ~27% at shape edge
  grad.addColorStop(1,              color + '00');  // transparent at glow edge

  cx.fillStyle = grad;
  cx.beginPath();
  cx.arc(total, total, total, 0, Math.PI * 2);
  cx.fill();

  glowCache.set(key, off);
  return off;
}

// Pre-computed glow geometry constants (logical pixels, based on CELL = 20)
const FOOD_RADIUS = CELL / 2 - 2;  // 8
const FOOD_GLOW   = 12;
const FOOD_TOTAL  = FOOD_RADIUS + FOOD_GLOW;  // 20
const HEAD_RADIUS = CELL / 2 - 1;  // 9
const HEAD_GLOW   = 10;
const HEAD_TOTAL  = HEAD_RADIUS + HEAD_GLOW;  // 19

// ─── Frame draw ───────────────────────────────────────────────────────────────

/**
 * Render one frame to `canvas`.
 * Called by the rAF loop; reads game state directly from refs — no React involved.
 */
function drawFrame(canvas, headIdxRef, snakeLenRef, foodRef, colorRef) {
  const dpr = window.devicePixelRatio || 1;

  if (canvas.width !== SIZE * dpr || canvas.height !== SIZE * dpr) {
    canvas.width  = SIZE * dpr;
    canvas.height = SIZE * dpr;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ── Layer 1: background + grid (cached offscreen canvas) ────────────────────
  const grid = getGridCanvas();
  if (!grid) return;
  ctx.drawImage(grid, 0, 0, SIZE, SIZE);

  const food     = foodRef.current;
  const color    = colorRef.current;
  const headIdx  = headIdxRef.current;
  const snakeLen = snakeLenRef.current;

  // ── Layer 2: food ────────────────────────────────────────────────────────────
  const fx = food.x * CELL + CELL / 2;
  const fy = food.y * CELL + CELL / 2;

  // Glow sprite drawn behind the solid circle
  const foodGlow = buildGlowSprite('#ff4757', FOOD_RADIUS, FOOD_GLOW);
  if (foodGlow) {
    ctx.drawImage(foodGlow, fx - FOOD_TOTAL, fy - FOOD_TOTAL, FOOD_TOTAL * 2, FOOD_TOTAL * 2);
  }
  ctx.fillStyle = '#ff4757';
  ctx.beginPath();
  ctx.arc(fx, fy, FOOD_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // ── Layer 3: snake ───────────────────────────────────────────────────────────
  for (let i = 0; i < snakeLen; i++) {
    const seg   = segPool[(headIdx + i) % POOL_SIZE];
    const alpha = i === 0 ? 1 : Math.max(0.3, 1 - (i / snakeLen) * 0.7);
    const hex   = Math.round(alpha * 255).toString(16).padStart(2, '0');

    ctx.fillStyle = i === 0 ? color : `${color}${hex}`;

    if (i === 0) {
      // Head: draw glow sprite behind the head rect
      const headGlow = buildGlowSprite(color, HEAD_RADIUS, HEAD_GLOW);
      if (headGlow) {
        const cx = seg.x * CELL + CELL / 2;
        const cy = seg.y * CELL + CELL / 2;
        ctx.drawImage(headGlow, cx - HEAD_TOTAL, cy - HEAD_TOTAL, HEAD_TOTAL * 2, HEAD_TOTAL * 2);
      }
    }

    const pad = i === 0 ? 1 : 2;
    ctx.beginPath();
    ctx.roundRect(
      seg.x * CELL + pad,
      seg.y * CELL + pad,
      CELL - pad * 2,
      CELL - pad * 2,
      i === 0 ? 4 : 3
    );
    ctx.fill();
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Props:
 *   headIdxRef  MutableRefObject<number>   — pool head index from useSnake
 *   snakeLenRef MutableRefObject<number>   — live segment count from useSnake
 *   foodRef     MutableRefObject<{x,y}>    — food position from useSnake
 *   levelIndex  number                     — selects the snake / border accent color
 */
export function GameCanvas({ headIdxRef, snakeLenRef, foodRef, levelIndex }) {
  const canvasRef = useRef(null);
  const color     = LEVELS[levelIndex]?.color ?? '#4ecca3';

  // colorRef lets the rAF loop always read the current level color without
  // restarting the loop on every level-up.
  const colorRef = useRef(color);
  // Sync colorRef before the browser paints so the rAF loop never reads a stale color.
  useLayoutEffect(() => { colorRef.current = color; }, [color]);

  // Start the rAF render loop once on mount; it runs for the component's lifetime.
  // The loop reads all game data from refs, so it never needs to restart when
  // snake/food/level change — those changes are visible immediately via the refs.
  useEffect(() => {
    let rafId;
    const loop = () => {
      const canvas = canvasRef.current;
      if (canvas) drawFrame(canvas, headIdxRef, snakeLenRef, foodRef, colorRef);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Snake game"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        borderRadius: '8px',
        border: `2px solid ${color}33`,
      }}
    />
  );
}
