/**
 * GameCanvas — HTML5 Canvas renderer with themed graphics.
 *
 * Draws three layers on every animation frame:
 *   1. Floor       (diagonal ambient gradient + two-tone tile-edge bevel, cached)
 *   2. Food        (Trump caricature: orange skin, golden hair, red tie)
 *   3. Snake       (King Cobra: olive-black body, cream banding, hood + slit eyes)
 *
 * Graphics style (Canvas 2D, zero extra dependencies):
 *   Snake segments are King Cobra sprites: olive-black body with cream banding,
 *   overlapping arc scale texture, and a hooded head with gold slit-pupil eyes
 *   and a forked red tongue.
 *   Food is a Trump caricature: orange skin, golden hair, pursed mouth, red tie.
 *   The grid floor has a diagonal ambient-light gradient and two-tone tile edges
 *   (bright highlight on top/left, dark shadow on bottom/right).
 *
 *   All sprites are cached by (type, dpr) so each combination is built once
 *   and reused every frame. Cobra/Trump textures are level-color independent.
 *
 * Rendering is driven by a requestAnimationFrame loop that reads game state
 * directly from refs — bypassing React reconciliation on every tick.
 *
 * Retina / high-DPI: all offscreen canvases are sized at dpr resolution and
 * drawn at logical size, achieving 1:1 physical pixel mapping.
 */
import { useEffect, useRef } from 'react';
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
const MAX_SPRITE_CACHE = 40;

// ─── Glow halo sprite cache ───────────────────────────────────────────────────
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
  grad.addColorStop(0,              color + 'cc');
  grad.addColorStop(radius / total, color + '44');
  grad.addColorStop(1,              color + '00');

  cx.fillStyle = grad;
  cx.beginPath();
  cx.arc(total, total, total, 0, Math.PI * 2);
  cx.fill();

  if (glowCache.size >= MAX_SPRITE_CACHE) glowCache.delete(glowCache.keys().next().value);
  glowCache.set(key, off);
  return off;
}

// ─── Segment sprite cache (King Cobra) ───────────────────────────────────────
// Each sprite is a CELL×CELL canvas depicting a King Cobra segment.
// Key: "cobra:h|b:dpr" — fixed texture regardless of level color.
const segSpriteCache = new Map();

function buildCobraSprite(isHead) {
  const dpr = window.devicePixelRatio || 1;
  const key = `cobra:${isHead ? 'h' : 'b'}:${dpr}`;
  if (segSpriteCache.has(key)) return segSpriteCache.get(key);

  const off = document.createElement('canvas');
  off.width  = CELL * dpr;
  off.height = CELL * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  const C  = CELL;    // 20
  const HC = C / 2;   // 10

  // ── Base fill — deep olive-black ──────────────────────────────────────────
  cx.fillStyle = '#111208';
  cx.fillRect(0, 0, C, C);

  if (isHead) {
    // ── Head: cobra hood ─────────────────────────────────────────────────────
    cx.save();
    cx.beginPath();
    cx.rect(0, 0, C, C);
    cx.clip();

    // Hood body — dark olive-green rounded shape
    cx.fillStyle = '#2a3010';
    cx.beginPath();
    cx.ellipse(HC, HC - 1, HC + 3, HC - 1, 0, 0, Math.PI * 2);
    cx.fill();

    // Hood pattern — King Cobra spectacle marking (cream)
    cx.strokeStyle = '#c8b87a';
    cx.lineWidth = 0.9;
    cx.beginPath();
    cx.arc(HC - 3, HC - 2, 2.4, Math.PI * 0.3, Math.PI * 1.7);
    cx.stroke();
    cx.beginPath();
    cx.arc(HC + 3, HC - 2, 2.4, Math.PI * 1.3, Math.PI * 2.7);
    cx.stroke();
    // Bridge connecting the two arcs
    cx.beginPath();
    cx.moveTo(HC - 1.2, HC - 2.8);
    cx.lineTo(HC + 1.2, HC - 2.8);
    cx.stroke();

    // Hood rim highlight
    cx.strokeStyle = 'rgba(80,90,40,0.60)';
    cx.lineWidth   = 0.6;
    cx.beginPath();
    cx.ellipse(HC, HC - 1, HC + 2.5, HC - 1.5, 0, Math.PI * 1.1, Math.PI * 2.0);
    cx.stroke();

    cx.restore();

    // ── Snout / face area ────────────────────────────────────────────────────
    cx.fillStyle = '#1e2510';
    cx.beginPath();
    cx.ellipse(HC, HC + 2, HC * 0.55, HC * 0.45, 0, 0, Math.PI * 2);
    cx.fill();

    // ── Eyes — gold slit pupils ───────────────────────────────────────────────
    const eyeY  = HC + 0.5;
    const eyeOX = HC * 0.40;
    for (const sign of [-1, 1]) {
      const ex = HC + sign * eyeOX;
      // Gold iris
      cx.fillStyle = '#ffaa00';
      cx.beginPath();
      cx.ellipse(ex, eyeY, 2.0, 1.8, 0, 0, Math.PI * 2);
      cx.fill();
      // Vertical slit pupil
      cx.fillStyle = '#000';
      cx.beginPath();
      cx.ellipse(ex, eyeY, 0.55, 1.6, 0, 0, Math.PI * 2);
      cx.fill();
      // Eye shine
      cx.fillStyle = 'rgba(255,230,150,0.55)';
      cx.beginPath();
      cx.ellipse(ex - 0.5, eyeY - 0.6, 0.55, 0.35, -0.5, 0, Math.PI * 2);
      cx.fill();
    }

    // ── Forked tongue ─────────────────────────────────────────────────────────
    cx.strokeStyle = '#cc1111';
    cx.lineWidth   = 0.75;
    cx.beginPath();
    cx.moveTo(HC, C - 1.5);
    cx.lineTo(HC, C + 0.5);
    cx.stroke();
    cx.beginPath();
    cx.moveTo(HC, C - 0.5);
    cx.lineTo(HC - 2, C + 1.5);
    cx.stroke();
    cx.beginPath();
    cx.moveTo(HC, C - 0.5);
    cx.lineTo(HC + 2, C + 1.5);
    cx.stroke();

  } else {
    // ── Body segment ──────────────────────────────────────────────────────────

    // Cream/ivory inter-scale band — King Cobra banding
    cx.fillStyle = '#d4c282';
    cx.fillRect(0, HC - 1.8, C, 3.6);

    // Dark edges on band for depth
    const bandGrad = cx.createLinearGradient(0, HC - 2, 0, HC + 2);
    bandGrad.addColorStop(0,   'rgba(50,45,10,0.55)');
    bandGrad.addColorStop(0.3, 'rgba(0,0,0,0)');
    bandGrad.addColorStop(0.7, 'rgba(0,0,0,0)');
    bandGrad.addColorStop(1,   'rgba(50,45,10,0.55)');
    cx.fillStyle = bandGrad;
    cx.fillRect(0, HC - 2, C, 4);

    // ── Scale arc pattern ─────────────────────────────────────────────────────
    cx.fillStyle   = '#1e2510';
    cx.strokeStyle = '#2e3818';
    cx.lineWidth   = 0.5;
    const rows = [HC - 5.5, HC + 5.5];
    for (const ry of rows) {
      for (let col = 0; col < 4; col++) {
        const rx = (col - 0.5) * 5.5;
        cx.beginPath();
        cx.ellipse(rx, ry, 3.2, 2.2, 0, 0, Math.PI * 2);
        cx.fill();
        cx.stroke();
      }
    }

    // ── Diagonal sheen ────────────────────────────────────────────────────────
    const sheen = cx.createLinearGradient(0, 0, C, C);
    sheen.addColorStop(0,   'rgba(255,255,200,0.07)');
    sheen.addColorStop(0.4, 'rgba(255,255,200,0.03)');
    sheen.addColorStop(1,   'rgba(0,0,0,0)');
    cx.fillStyle = sheen;
    cx.fillRect(0, 0, C, C);
  }

  if (segSpriteCache.size >= MAX_SPRITE_CACHE) segSpriteCache.delete(segSpriteCache.keys().next().value);
  segSpriteCache.set(key, off);
  return off;
}

// ─── Food sprite cache (Trump caricature) ─────────────────────────────────────
// A (CELL + FOOD_PAD*2) × (CELL + FOOD_PAD*2) canvas containing a Trump face.
const foodSpriteCache = new Map();

function buildTrumpSprite() {
  const dpr = window.devicePixelRatio || 1;
  const key = `trump:${dpr}`;
  if (foodSpriteCache.has(key)) return foodSpriteCache.get(key);

  const S  = CELL + FOOD_PAD * 2;   // logical sprite size (26×26)
  const CX = S / 2;
  const CY = S / 2;
  const R  = FOOD_RADIUS;           // face circle radius (8)

  const off = document.createElement('canvas');
  off.width  = S * dpr;
  off.height = S * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  // ── Drop shadow ───────────────────────────────────────────────────────────
  const shadow = cx.createRadialGradient(CX + 1.5, CY + 2, 0, CX + 1.5, CY + 2, R + 3);
  shadow.addColorStop(0, 'rgba(0,0,0,0.50)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = shadow;
  cx.beginPath();
  cx.arc(CX + 1.5, CY + 2, R + 4, 0, Math.PI * 2);
  cx.fill();

  // ── Hair (behind face — drawn first) ─────────────────────────────────────
  cx.fillStyle = '#f5c518';
  cx.beginPath();
  cx.ellipse(CX - 0.5, CY - R * 0.55, R * 1.05, R * 0.75, -0.18, 0, Math.PI * 2);
  cx.fill();
  // Lighter streak for volume
  const hairGrad = cx.createRadialGradient(CX - 1, CY - R * 0.85, 0, CX - 1, CY - R * 0.55, R * 0.9);
  hairGrad.addColorStop(0, 'rgba(255,235,120,0.85)');
  hairGrad.addColorStop(1, 'rgba(200,150,10,0)');
  cx.fillStyle = hairGrad;
  cx.beginPath();
  cx.ellipse(CX - 1, CY - R * 0.7, R * 0.85, R * 0.60, -0.18, 0, Math.PI * 2);
  cx.fill();

  // ── Face circle (clipped) ─────────────────────────────────────────────────
  cx.save();
  cx.beginPath();
  cx.arc(CX, CY, R, 0, Math.PI * 2);
  cx.clip();

  // Orange skin with radial gradient (lit from top-left)
  const skin = cx.createRadialGradient(CX - R * 0.30, CY - R * 0.30, 0, CX, CY, R);
  skin.addColorStop(0,    '#ffcc88');
  skin.addColorStop(0.45, '#e8843a');
  skin.addColorStop(1,    '#b85c18');
  cx.fillStyle = skin;
  cx.fillRect(CX - R, CY - R, R * 2, R * 2);

  // Jowl shadow in the lower third
  const jowl = cx.createLinearGradient(CX, CY + R * 0.35, CX, CY + R);
  jowl.addColorStop(0, 'rgba(180,80,20,0)');
  jowl.addColorStop(1, 'rgba(160,65,15,0.35)');
  cx.fillStyle = jowl;
  cx.fillRect(CX - R, CY + R * 0.35, R * 2, R * 0.65);

  // ── Eyes ──────────────────────────────────────────────────────────────────
  const eyeY  = CY - R * 0.12;
  const eyeOX = R * 0.35;
  for (const sign of [-1, 1]) {
    const ex = CX + sign * eyeOX;
    cx.fillStyle = '#e8e0d0';
    cx.beginPath();
    cx.ellipse(ex, eyeY, R * 0.165, R * 0.105, 0, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = '#6688aa';
    cx.beginPath();
    cx.ellipse(ex, eyeY, R * 0.095, R * 0.095, 0, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = '#111';
    cx.beginPath();
    cx.ellipse(ex, eyeY, R * 0.045, R * 0.045, 0, 0, Math.PI * 2);
    cx.fill();
  }

  // ── Brow ridges ───────────────────────────────────────────────────────────
  cx.strokeStyle = '#a05818';
  cx.lineWidth   = 0.9;
  for (const sign of [-1, 1]) {
    const bx = CX + sign * eyeOX;
    cx.beginPath();
    cx.arc(bx, eyeY - R * 0.16, R * 0.22, Math.PI + 0.35, Math.PI * 2 - 0.35);
    cx.stroke();
  }

  // ── Nose ──────────────────────────────────────────────────────────────────
  cx.fillStyle = 'rgba(160,75,20,0.30)';
  cx.beginPath();
  cx.ellipse(CX, CY + R * 0.14, R * 0.10, R * 0.07, 0, 0, Math.PI * 2);
  cx.fill();

  // ── Pursed mouth ──────────────────────────────────────────────────────────
  cx.strokeStyle = '#aa3311';
  cx.lineWidth   = 1.1;
  cx.beginPath();
  cx.arc(CX, CY + R * 0.44, R * 0.26, Math.PI + 0.45, Math.PI * 2 - 0.45);
  cx.stroke();
  cx.strokeStyle = 'rgba(160,60,20,0.55)';
  cx.lineWidth   = 0.7;
  cx.beginPath();
  cx.moveTo(CX - R * 0.22, CY + R * 0.37);
  cx.lineTo(CX + R * 0.22, CY + R * 0.37);
  cx.stroke();

  cx.restore();  // end face clip

  // ── Red tie (partially visible below face) ────────────────────────────────
  cx.fillStyle = '#cc1111';
  cx.beginPath();
  cx.moveTo(CX - R * 0.15, CY + R * 0.82);
  cx.lineTo(CX + R * 0.15, CY + R * 0.82);
  cx.lineTo(CX + R * 0.08, CY + R * 1.05);
  cx.lineTo(CX,            CY + R * 1.18);
  cx.lineTo(CX - R * 0.08, CY + R * 1.05);
  cx.closePath();
  cx.fill();

  // ── Specular sheen (top-left, subtle) ────────────────────────────────────
  cx.fillStyle = 'rgba(255,255,255,0.22)';
  cx.beginPath();
  cx.ellipse(CX - R * 0.38, CY - R * 0.38, R * 0.20, R * 0.12, -0.42, 0, Math.PI * 2);
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
function drawFrame(canvas, headIdxRef, snakeLenRef, foodRef) {
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
  const headIdx  = headIdxRef.current;
  const snakeLen = snakeLenRef.current;

  // ── Layer 2: food (Trump face) ────────────────────────────────────────────
  const fx = food.x * CELL + CELL / 2;
  const fy = food.y * CELL + CELL / 2;

  // Orange glow halo — spray-tan ambience
  const foodGlow = buildGlowSprite('#ff8800', FOOD_RADIUS, FOOD_GLOW);
  if (foodGlow) {
    ctx.globalAlpha = 0.50;
    ctx.drawImage(foodGlow, fx - FOOD_TOTAL, fy - FOOD_TOTAL, FOOD_TOTAL * 2, FOOD_TOTAL * 2);
    ctx.globalAlpha = 1;
  }

  // Trump caricature sprite
  const foodSpr = buildTrumpSprite();
  if (foodSpr) {
    const S = CELL + FOOD_PAD * 2;
    ctx.drawImage(foodSpr, food.x * CELL - FOOD_PAD, food.y * CELL - FOOD_PAD, S, S);
  }

  // ── Layer 3: snake (King Cobra) ────────────────────────────────────────────
  const headSprite = buildCobraSprite(true);
  const bodySprite = buildCobraSprite(false);

  for (let i = 0; i < snakeLen; i++) {
    const seg   = segPool[(headIdx + i) % POOL_SIZE];
    // Alpha fades linearly from 1.0 at the head down to a floor of 0.3 at the tail.
    const alpha = i === 0 ? 1 : Math.max(0.3, 1 - (i / snakeLen) * 0.7);
    ctx.globalAlpha = alpha;

    if (i === 0) {
      // Head: amber gold glow — cobra eye colour
      const headGlow = buildGlowSprite('#ffaa00', HEAD_RADIUS, HEAD_GLOW);
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
 *   levelIndex  number                     — selects the border accent color
 */
export function GameCanvas({ headIdxRef, snakeLenRef, foodRef, levelIndex }) {
  const canvasRef = useRef(null);
  const color     = LEVELS[levelIndex]?.color ?? '#4ecca3';

  // rAF loop runs for the component's lifetime; all game data is read from refs.
  useEffect(() => {
    let rafId;
    const loop = () => {
      const canvas = canvasRef.current;
      if (canvas) drawFrame(canvas, headIdxRef, snakeLenRef, foodRef);
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
        border: `2px solid ${color}55`,
      }}
    />
  );
}
