/**
 * GameCanvas — HTML5 Canvas renderer for the snake board.
 *
 * Draws three layers on every game tick:
 *   1. Background + grid  (blit from offscreen cache — drawn only once ever)
 *   2. Food               (glowing red circle)
 *   3. Snake              (rounded rectangles, head glows, body fades toward tail)
 *
 * Retina / high-DPI:
 *   The canvas physical pixel size = SIZE × devicePixelRatio.
 *   The 2D context is scaled by the same ratio so all draw coordinates stay
 *   in logical pixels. CSS keeps the element at 100% of its container.
 *   Result: crisp rendering on 2×/3× screens without changing any draw code.
 */
import { useEffect, useRef } from 'react';
import { COLS, ROWS, CELL, LEVELS } from '../constants';

const SIZE = COLS * CELL;  // logical canvas size in pixels (400 × 400 at default settings)

// ─── Offscreen grid cache ─────────────────────────────────────────────────────
// The background and grid lines are static — they never change during a game.
// We draw them once into an offscreen canvas and blit with one drawImage() call
// each frame, replacing ~41 individual stroke() calls with a single copy.
let gridCache = null;

function getGridCanvas() {
  if (gridCache) return gridCache;  // already built — skip redraw

  const offscreen = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  offscreen.width  = SIZE * dpr;
  offscreen.height = SIZE * dpr;

  const ctx = offscreen.getContext('2d');
  ctx.scale(dpr, dpr);

  // Solid dark background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle grid — all lines batched into one path, one stroke() call
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

  gridCache = offscreen;
  return offscreen;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Props:
 *   snake       {x,y}[]   — segment array from useSnake, head at index 0
 *   food        {x,y}     — food cell position
 *   levelIndex  number    — selects the snake / border accent color
 */
export function GameCanvas({ snake, food, levelIndex }) {
  const canvasRef = useRef(null);
  const color = LEVELS[levelIndex]?.color ?? '#4ecca3';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;

    // Update physical pixel dimensions only when dpr changes
    if (canvas.width !== SIZE * dpr || canvas.height !== SIZE * dpr) {
      canvas.width  = SIZE * dpr;
      canvas.height = SIZE * dpr;
    }

    const ctx = canvas.getContext('2d');
    // All draw coordinates are in logical pixels; transform scales to physical
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ── Layer 1: background + grid (cached offscreen canvas) ──────────────────
    ctx.drawImage(getGridCanvas(), 0, 0, SIZE, SIZE);

    // ── Layer 2: food ─────────────────────────────────────────────────────────
    // Center the circle within its cell
    const fx = food.x * CELL + CELL / 2;
    const fy = food.y * CELL + CELL / 2;
    ctx.fillStyle   = '#ff4757';
    ctx.shadowColor = '#ff4757';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.arc(fx, fy, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;  // reset shadow — it bleeds into subsequent draws if left set

    // ── Layer 3: snake ────────────────────────────────────────────────────────
    snake.forEach((seg, i) => {
      // Body opacity fades linearly from 1.0 (head) down to 0.3 (end of tail)
      const alpha = i === 0 ? 1 : Math.max(0.3, 1 - (i / snake.length) * 0.7);

      // Append 2-digit hex alpha to the 6-digit color string.
      // "#4ecca3" + "e0" → "#4ecca3e0"  (CSS Color Level 4 8-digit hex, all modern browsers)
      const hex = Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.fillStyle   = i === 0 ? color : `${color}${hex}`;
      ctx.shadowColor = i === 0 ? color : 'transparent';
      ctx.shadowBlur  = i === 0 ? 10 : 0;

      const pad = i === 0 ? 1 : 2;  // head slightly larger than body segments
      ctx.beginPath();
      ctx.roundRect(
        seg.x * CELL + pad,
        seg.y * CELL + pad,
        CELL - pad * 2,
        CELL - pad * 2,
        i === 0 ? 4 : 3
      );
      ctx.fill();
    });
    ctx.shadowBlur = 0;

  }, [snake, food, color]);  // re-draw on every snake move, food change, or level-up

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Snake game"
      style={{
        display: 'block',
        width: '100%',          // CSS size = logical container size
        height: '100%',         // physical pixels are set in the effect above
        borderRadius: '8px',
        border: `2px solid ${color}33`,  // 33 hex ≈ 20% opacity colored border
      }}
    />
  );
}
