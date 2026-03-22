/**
 * GameCanvas — HTML5 Canvas renderer with 3D-styled graphics.
 *
 * Draws three layers on every animation frame:
 *   1. Floor       (diagonal ambient gradient + two-tone tile-edge bevel, cached)
 *   2. Food        (ambient glow halo + pre-baked 3D sphere sprite)
 *   3. Snake       (ambient glow on head + pre-baked 3D bead sprites;
 *                   body segments fade toward the tail via globalAlpha)
 *
 * 3D shading approach (Canvas 2D, zero extra dependencies):
 *   Each segment is a pre-rendered CELL×CELL offscreen canvas ("bead sprite")
 *   with a radial gradient simulating a point light from the top-left, a dark
 *   rim stroke, and two specular highlights — primary (sharp) + secondary (soft).
 *   Food is a sphere sprite: radial gradient, drop shadow, dual specular.
 *   The grid floor has a diagonal ambient-light gradient and two-tone tile edges
 *   (bright highlight on top/left, dark shadow on bottom/right).
 *
 *   All sprites are cached by (color, type, dpr) so each unique combination is
 *   built once and reused every frame. Level-up naturally produces new sprites.
 *
 * Rendering is driven by a requestAnimationFrame loop that reads game state
 * directly from refs — bypassing React reconciliation on every tick.
 *
 * Retina / high-DPI: all offscreen canvases are sized at dpr resolution and
 * drawn at logical size, achieving 1:1 physical pixel mapping.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { COLS, ROWS, CELL, LEVELS } from '../constants';
import { segPool, POOL_SIZE } from '../pool';

const SIZE = COLS * CELL;  // 400 × 400 logical pixels at default settings

// ─── Geometry constants ───────────────────────────────────────────────────────
const FOOD_RADIUS = CELL / 2 - 2;               // 8  — food circle radius
const FOOD_GLOW   = 14;                          // halo size around food
const FOOD_TOTAL  = FOOD_RADIUS + FOOD_GLOW;     // 22
const FOOD_PAD    = 3;                           // sprite padding for drop shadow
const HEAD_RADIUS = CELL / 2 - 1;               // 9  — head glow inner radius
const HEAD_GLOW   = 10;                          // halo size around head
const HEAD_TOTAL  = HEAD_RADIUS + HEAD_GLOW;     // 19

// ─── Color helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Return a CSS rgb() string brightened by `amt` (each channel clamped to 255). */
function lighten(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
}

/** Return a CSS rgb() string darkened by `amt` (each channel clamped to 0). */
function darken(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.max(0, r - amt)},${Math.max(0, g - amt)},${Math.max(0, b - amt)})`;
}

// ─── Offscreen floor cache ────────────────────────────────────────────────────
// Built once (per dpr) — contains the dark tile floor with ambient light.
let gridCache    = null;
let gridCacheDpr = 0;

function getGridCanvas() {
  const dpr = window.devicePixelRatio || 1;
  if (gridCache && gridCacheDpr === dpr) return gridCache;

  const off = document.createElement('canvas');
  off.width  = SIZE * dpr;
  off.height = SIZE * dpr;
  const ctx  = off.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // ── Dark base ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Diagonal ambient light ─────────────────────────────────────────────────
  // Simulates diffuse illumination from the top-left, like an overhead light
  // slightly off-centre.  Makes the floor feel like a polished dark surface.
  const ambient = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  ambient.addColorStop(0,    'rgba(255,255,255,0.055)');
  ambient.addColorStop(0.45, 'rgba(0,0,0,0)');
  ambient.addColorStop(1,    'rgba(0,0,0,0.10)');
  ctx.fillStyle = ambient;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Tile highlight edges (top & left of each cell — catch the light) ───────
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth   = 0.5;
  ctx.beginPath();
  for (let i = 0; i <= COLS; i++) { ctx.moveTo(i * CELL, 0);    ctx.lineTo(i * CELL, SIZE); }
  for (let j = 0; j <= ROWS; j++) { ctx.moveTo(0, j * CELL);    ctx.lineTo(SIZE, j * CELL); }
  ctx.stroke();

  // ── Tile shadow edges (bottom & right of each cell — in shade) ─────────────
  // Drawn 0.5 px inward from the highlight so the two lines form a bevel.
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth   = 0.5;
  ctx.beginPath();
  for (let i = 1; i <= COLS; i++) { ctx.moveTo(i * CELL - 0.5, 0); ctx.lineTo(i * CELL - 0.5, SIZE); }
  for (let j = 1; j <= ROWS; j++) { ctx.moveTo(0, j * CELL - 0.5); ctx.lineTo(SIZE, j * CELL - 0.5); }
  ctx.stroke();

  gridCacheDpr = dpr;
  gridCache    = off;
  return off;
}

// ─── Sprite cache shared limit ───────────────────────────────────────────────
// Each cache is keyed by color/type/dpr and stays small in normal play (~40
// entries total), but has no natural upper bound — e.g. dragging the window
// across monitors with different devicePixelRatio values adds new entries
// indefinitely.  MAX_SPRITE_CACHE caps each cache independently; when exceeded
// the oldest entry (FIFO via Map insertion order) is evicted.
const MAX_SPRITE_CACHE = 40;

// ─── Glow halo sprite cache ───────────────────────────────────────────────────
// Radial-gradient halos extend beyond the cell boundary, giving each element
// a subtle ambient-light bloom.  Built once per (color, radius, glowSize, dpr).
const glowCache = new Map();

function buildGlowSprite(color, radius, glowSize) {
  const dpr   = window.devicePixelRatio || 1;
  const key   = `${color}:${radius}:${glowSize}:${dpr}`;
  if (glowCache.has(key)) return glowCache.get(key);

  const total   = radius + glowSize;
  const logical = total * 2;
  const off     = document.createElement('canvas');
  off.width     = logical * dpr;
  off.height    = logical * dpr;
  const cx      = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  const grad = cx.createRadialGradient(total, total, 0, total, total, total);
  grad.addColorStop(0,              color + 'cc');  // ~80% alpha at centre
  grad.addColorStop(radius / total, color + '44');  // ~27% alpha at shape edge
  grad.addColorStop(1,              color + '00');  // transparent at halo edge

  cx.fillStyle = grad;
  cx.beginPath();
  cx.arc(total, total, total, 0, Math.PI * 2);
  cx.fill();

  if (glowCache.size >= MAX_SPRITE_CACHE) glowCache.delete(glowCache.keys().next().value);
  glowCache.set(key, off);
  return off;
}

// ─── Segment sprite cache (3D beads) ─────────────────────────────────────────
// Each sprite is a CELL×CELL canvas depicting a shiny 3D rounded segment.
// Key: "color:h|b:dpr" — a level change naturally generates a new sprite.
const segSpriteCache = new Map();

function buildSegSprite(color, isHead) {
  const dpr = window.devicePixelRatio || 1;
  const key = `${color}:${isHead ? 'h' : 'b'}:${dpr}`;
  if (segSpriteCache.has(key)) return segSpriteCache.get(key);

  const off = document.createElement('canvas');
  off.width  = CELL * dpr;
  off.height = CELL * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  const pad    = isHead ? 1 : 2;
  const radius = isHead ? 4 : 3;

  // ── 3D radial gradient fill ───────────────────────────────────────────────
  // Inner centre is offset toward the top-left (the simulated light source).
  // Outer circle is centred slightly toward the bottom-right so the dark
  // shadow zone fills the far corner of the bead.
  const lightX = CELL * 0.32;
  const lightY = CELL * 0.30;
  const grad = cx.createRadialGradient(
    lightX,      lightY,      0,           // bright inner spot
    CELL * 0.57, CELL * 0.57, CELL * 0.87  // outer shadow circle
  );
  grad.addColorStop(0,    lighten(color, 90));  // bright highlight near light
  grad.addColorStop(0.27, lighten(color, 28));  // illuminated zone
  grad.addColorStop(0.60, color);               // base/mid colour
  grad.addColorStop(1,    darken(color, 68));   // deep shadow at far edge

  cx.fillStyle = grad;
  cx.beginPath();
  cx.roundRect(pad, pad, CELL - pad * 2, CELL - pad * 2, radius);
  cx.fill();

  // ── Dark rim stroke ───────────────────────────────────────────────────────
  // Thin dark outline emphasises the segment's 3D boundary and separates it
  // from adjacent segments of similar colour.
  cx.strokeStyle = darken(color, 90);
  cx.lineWidth   = 0.75;
  cx.beginPath();
  cx.roundRect(pad, pad, CELL - pad * 2, CELL - pad * 2, radius);
  cx.stroke();

  // ── Primary specular highlight ────────────────────────────────────────────
  // Sharp bright ellipse near the top-left — the direct reflection of the
  // point light source off the convex surface of the bead.
  cx.fillStyle = 'rgba(255,255,255,0.65)';
  cx.beginPath();
  cx.ellipse(CELL * 0.30, CELL * 0.27, CELL * 0.115, CELL * 0.075, -0.42, 0, Math.PI * 2);
  cx.fill();

  // ── Secondary specular highlight ──────────────────────────────────────────
  // Softer, smaller secondary spec slightly further from the primary — common
  // in photographs of spherical glossy objects.
  cx.fillStyle = 'rgba(255,255,255,0.25)';
  cx.beginPath();
  cx.ellipse(CELL * 0.39, CELL * 0.22, CELL * 0.073, CELL * 0.047, -0.30, 0, Math.PI * 2);
  cx.fill();

  if (segSpriteCache.size >= MAX_SPRITE_CACHE) segSpriteCache.delete(segSpriteCache.keys().next().value);
  segSpriteCache.set(key, off);
  return off;
}

// ─── Food sprite cache (3D sphere) ────────────────────────────────────────────
// A (CELL + FOOD_PAD*2) × (CELL + FOOD_PAD*2) canvas containing a shaded
// sphere with a drop shadow and two specular highlights.
const foodSpriteCache = new Map();

function buildFoodSprite() {
  const dpr = window.devicePixelRatio || 1;
  const key = `food:${dpr}`;
  if (foodSpriteCache.has(key)) return foodSpriteCache.get(key);

  const S  = CELL + FOOD_PAD * 2;   // logical sprite size
  const CX = S / 2;                 // logical sprite centre
  const CY = S / 2;

  const off = document.createElement('canvas');
  off.width  = S * dpr;
  off.height = S * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  // ── Drop shadow ───────────────────────────────────────────────────────────
  // Soft dark ellipse offset down-right, giving the sphere the impression of
  // floating slightly above the grid floor.
  const shadow = cx.createRadialGradient(CX + 2, CY + 2.5, 0, CX + 2, CY + 2.5, FOOD_RADIUS + 3);
  shadow.addColorStop(0, 'rgba(0,0,0,0.52)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = shadow;
  cx.beginPath();
  cx.arc(CX + 2, CY + 2.5, FOOD_RADIUS + 4, 0, Math.PI * 2);
  cx.fill();

  // ── Sphere body ────────────────────────────────────────────────────────────
  // Radial gradient with light from top-left, mid-tone around the equator,
  // and a deep shadow at the bottom-right limb.
  const lightX = CX - FOOD_RADIUS * 0.38;
  const lightY = CY - FOOD_RADIUS * 0.38;
  const sphere = cx.createRadialGradient(lightX, lightY, 0, CX, CY, FOOD_RADIUS);
  sphere.addColorStop(0,    '#ff9fa8');  // pinkish-white highlight
  sphere.addColorStop(0.30, '#ff4757');  // vivid red mid-tone
  sphere.addColorStop(0.65, '#cc2233');  // darker red shadow zone
  sphere.addColorStop(1,    '#7a0d1c');  // deep shadow at limb edge

  cx.fillStyle = sphere;
  cx.beginPath();
  cx.arc(CX, CY, FOOD_RADIUS, 0, Math.PI * 2);
  cx.fill();

  // ── Primary specular ──────────────────────────────────────────────────────
  cx.fillStyle = 'rgba(255,255,255,0.80)';
  cx.beginPath();
  cx.ellipse(
    CX - FOOD_RADIUS * 0.37, CY - FOOD_RADIUS * 0.37,
    FOOD_RADIUS * 0.25,      FOOD_RADIUS * 0.16,
    -0.42, 0, Math.PI * 2
  );
  cx.fill();

  // ── Secondary specular (tiny, tight) ──────────────────────────────────────
  cx.fillStyle = 'rgba(255,255,255,0.40)';
  cx.beginPath();
  cx.ellipse(
    CX - FOOD_RADIUS * 0.52, CY - FOOD_RADIUS * 0.52,
    FOOD_RADIUS * 0.09,      FOOD_RADIUS * 0.056,
    -0.42, 0, Math.PI * 2
  );
  cx.fill();

  if (foodSpriteCache.size >= MAX_SPRITE_CACHE) foodSpriteCache.delete(foodSpriteCache.keys().next().value);
  foodSpriteCache.set(key, off);
  return off;
}

// ─── Frame renderer ───────────────────────────────────────────────────────────

/**
 * Render one frame to `canvas`.
 * Called by the rAF loop — reads game state directly from refs, no React involved.
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

  // ── Layer 1: floor ────────────────────────────────────────────────────────
  const grid = getGridCanvas();
  if (!grid) return;
  ctx.drawImage(grid, 0, 0, SIZE, SIZE);

  const food     = foodRef.current;
  const color    = colorRef.current;
  const headIdx  = headIdxRef.current;
  const snakeLen = snakeLenRef.current;

  // ── Layer 2: food ──────────────────────────────────────────────────────────
  const fx = food.x * CELL + CELL / 2;
  const fy = food.y * CELL + CELL / 2;

  // Glow halo — drawn at reduced opacity so it doesn't overpower the sphere
  const foodGlow = buildGlowSprite('#ff4757', FOOD_RADIUS, FOOD_GLOW);
  if (foodGlow) {
    ctx.globalAlpha = 0.50;
    ctx.drawImage(foodGlow, fx - FOOD_TOTAL, fy - FOOD_TOTAL, FOOD_TOTAL * 2, FOOD_TOTAL * 2);
    ctx.globalAlpha = 1;
  }

  // 3D sphere sprite
  const foodSpr = buildFoodSprite();
  if (foodSpr) {
    const S = CELL + FOOD_PAD * 2;
    ctx.drawImage(foodSpr, food.x * CELL - FOOD_PAD, food.y * CELL - FOOD_PAD, S, S);
  }

  // ── Layer 3: snake ─────────────────────────────────────────────────────────
  const headSprite = buildSegSprite(color, true);
  const bodySprite = buildSegSprite(color, false);

  for (let i = 0; i < snakeLen; i++) {
    const seg   = segPool[(headIdx + i) % POOL_SIZE];
    // Alpha fades linearly from 1.0 at the head down to a floor of 0.3 at the tail.
    // globalAlpha applies to both the glow and the bead so the 3D shading stays
    // proportionally correct as segments become translucent.
    const alpha = i === 0 ? 1 : Math.max(0.3, 1 - (i / snakeLen) * 0.7);
    ctx.globalAlpha = alpha;

    if (i === 0) {
      // Head: ambient glow halo behind the bead
      const headGlow = buildGlowSprite(color, HEAD_RADIUS, HEAD_GLOW);
      if (headGlow) {
        const hcx = seg.x * CELL + CELL / 2;
        const hcy = seg.y * CELL + CELL / 2;
        ctx.drawImage(headGlow, hcx - HEAD_TOTAL, hcy - HEAD_TOTAL, HEAD_TOTAL * 2, HEAD_TOTAL * 2);
      }
      if (headSprite) ctx.drawImage(headSprite, seg.x * CELL, seg.y * CELL, CELL, CELL);
    } else {
      if (bodySprite) ctx.drawImage(bodySprite, seg.x * CELL, seg.y * CELL, CELL, CELL);
    }
  }

  ctx.globalAlpha = 1;  // always reset after the snake loop
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

  // colorRef lets the rAF loop always read the latest level color without
  // restarting the loop on every level-up.
  const colorRef = useRef(color);
  useLayoutEffect(() => { colorRef.current = color; }, [color]);

  // rAF loop runs for the component's lifetime; all game data is read from refs.
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
        border: `2px solid ${color}55`,  // slightly more opaque for the 3D aesthetic
      }}
    />
  );
}
