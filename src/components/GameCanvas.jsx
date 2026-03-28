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
const HEAD_RADIUS = CELL / 2 - 1;               // 9  — head glow inner radius
const HEAD_GLOW   = 10;                          // halo size around head
const HEAD_TOTAL  = HEAD_RADIUS + HEAD_GLOW;     // 19

// ─── Offscreen floor cache ────────────────────────────────────────────────────
// Renders an Iranian desert landscape: Alborz mountain silhouette across the
// top rows, arid sand plains in the middle, cracked salt-flat kavir at the
// bottom, with per-cell terrain texture and earth-tone fissure grid lines.
let gridCache    = null;
let gridCacheDpr = 0;

// Seeded deterministic pseudo-random so the terrain is stable across redraws.
function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function getGridCanvas() {
  const dpr = window.devicePixelRatio || 1;
  if (gridCache && gridCacheDpr === dpr) return gridCache;

  const off = document.createElement('canvas');
  off.width  = SIZE * dpr;
  off.height = SIZE * dpr;
  const ctx  = off.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  const rand = seededRand(0xdeadbeef);

  // ── Sky band (top ~20% of grid) ─────────────────────────────────────────────
  // Hazy midday sky — typical of Iranian high-altitude plateau haze.
  const skyH = SIZE * 0.22;
  const sky  = ctx.createLinearGradient(0, 0, 0, skyH);
  sky.addColorStop(0,   '#c8dff5');  // pale blue zenith
  sky.addColorStop(0.5, '#d9e8f0');  // horizon haze
  sky.addColorStop(1,   '#e8d9b8');  // warm dust at mountain base
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SIZE, skyH);

  // ── Desert floor (below sky) ──────────────────────────────────────────────
  // Gradient from warm sandy ochre near the mountains to pale salt-flat at bottom.
  const desert = ctx.createLinearGradient(0, skyH, 0, SIZE);
  desert.addColorStop(0,    '#c8a45a');  // golden sand
  desert.addColorStop(0.40, '#d4ac62');  // bright mid-desert
  desert.addColorStop(0.75, '#c8b87a');  // fading to salt flat
  desert.addColorStop(1,    '#ddd4b0');  // pale kavir salt flat
  ctx.fillStyle = desert;
  ctx.fillRect(0, skyH, SIZE, SIZE - skyH);

  // ── Subtle terrain variation per cell ────────────────────────────────────────
  // Each cell gets a slight sand-tone tint to break up the monotony.
  for (let row = 0; row < ROWS; row++) {
    const fy = row / ROWS;
    for (let col = 0; col < COLS; col++) {
      const r = rand();
      if (fy < 0.22) continue;  // skip sky cells
      // Vary between darker rocky ground and brighter sand patches
      const bright = (r - 0.5) * 28;
      const base   = fy > 0.75 ? [210, 205, 175] : [205, 170, 90];
      ctx.fillStyle = `rgba(${base[0]+bright},${base[1]+bright*0.8},${base[2]+bright*0.6},0.28)`;
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
  }

  // ── Alborz mountain silhouette (confined to sky band) ────────────────────────
  // Three overlapping ridgelines in receding blue-grey tones.
  // Shapes fill FROM the ridge profile UP to the top of the canvas (not down to
  // the bottom), so they appear as silhouettes against the sky only.
  const ridges = [
    { yBase: skyH * 0.98, amp: 36, freq: 0.018, color: '#7a8fa0', alpha: 0.85 },  // far ridge
    { yBase: skyH * 0.90, amp: 26, freq: 0.024, color: '#91a3b5', alpha: 0.72 },  // mid ridge
    { yBase: skyH * 0.82, amp: 18, freq: 0.032, color: '#a8bbc9', alpha: 0.58 },  // near ridge
  ];

  for (const ridge of ridges) {
    ctx.save();
    ctx.globalAlpha = ridge.alpha;
    ctx.fillStyle   = ridge.color;
    ctx.beginPath();
    ctx.moveTo(0, skyH);                      // start at desert horizon, left edge
    for (let x = 0; x <= SIZE; x += 2) {
      // Stack three sine harmonics for natural-looking peaks
      const y = ridge.yBase
        - Math.sin(x * ridge.freq + 0.8)         * ridge.amp
        - Math.sin(x * ridge.freq * 2.3 + 2.1)   * ridge.amp * 0.42
        - Math.sin(x * ridge.freq * 0.57 + 1.3)  * ridge.amp * 0.28;
      ctx.lineTo(x, Math.min(y, skyH));        // cap at horizon — peaks only in sky
    }
    ctx.lineTo(SIZE, skyH);                   // end at desert horizon, right edge
    ctx.lineTo(SIZE, 0);                      // up to top-right corner
    ctx.lineTo(0, 0);                         // across to top-left corner
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Snow caps on highest peaks ────────────────────────────────────────────
  // Damavand-style white tips on the tallest mountain spires.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle   = '#f0f4f8';
  // Draw small white triangles at approximate peak locations
  for (const px of [60, 155, 265, 350]) {
    const peakY = ridges[2].yBase
      - Math.sin(px * 0.032 + 0.8)       * ridges[2].amp
      - Math.sin(px * 0.074 + 2.1)       * ridges[2].amp * 0.42
      - Math.sin(px * 0.018 + 1.3)       * ridges[2].amp * 0.28;
    ctx.beginPath();
    ctx.moveTo(px,      peakY);
    ctx.lineTo(px - 7,  peakY + 10);
    ctx.lineTo(px + 7,  peakY + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // ── Kavir (salt-flat) crackle in the bottom third ────────────────────────
  // Random polygonal crack lines mimicking the dried salt-lake surface.
  ctx.save();
  ctx.strokeStyle = 'rgba(160,140,100,0.38)';
  ctx.lineWidth   = 0.6;
  const kavirTop = SIZE * 0.70;
  for (let k = 0; k < 55; k++) {
    const x1 = rand() * SIZE;
    const y1 = kavirTop + rand() * (SIZE - kavirTop);
    const len = 8 + rand() * 20;
    const ang = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.cos(ang) * len, y1 + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();

  // ── Distant road / qanat line ────────────────────────────────────────────
  // A faint diagonal line suggesting the ancient qanat irrigation channels
  // visible in aerial views of the Iranian plateau.
  ctx.save();
  ctx.strokeStyle = 'rgba(140,115,70,0.28)';
  ctx.lineWidth   = 1.2;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(SIZE * 0.10, SIZE * 0.48);
  ctx.lineTo(SIZE * 0.72, SIZE * 0.92);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── Grid fissures (earth-tone cell borders) ───────────────────────────────
  // Replace white/black grid lines with warm cracked-earth tones.
  ctx.strokeStyle = 'rgba(120,85,40,0.22)';
  ctx.lineWidth   = 0.6;
  ctx.beginPath();
  for (let i = 0; i <= COLS; i++) { ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); }
  for (let j = 0; j <= ROWS; j++) { ctx.moveTo(0, j * CELL); ctx.lineTo(SIZE, j * CELL); }
  ctx.stroke();

  // Lighter highlight edge (sun catching the raised rim of each cell)
  ctx.strokeStyle = 'rgba(255,220,160,0.14)';
  ctx.lineWidth   = 0.4;
  ctx.beginPath();
  for (let i = 1; i <= COLS; i++) { ctx.moveTo(i * CELL - 0.4, 0); ctx.lineTo(i * CELL - 0.4, SIZE); }
  for (let j = 1; j <= ROWS; j++) { ctx.moveTo(0, j * CELL - 0.4); ctx.lineTo(SIZE, j * CELL - 0.4); }
  ctx.stroke();

  gridCacheDpr = dpr;
  gridCache    = off;
  return off;
}

// ─── Sprite cache shared limit ───────────────────────────────────────────────
const MAX_SPRITE_CACHE = 40;
const FRUIT_GLOW_COLORS = ['#cc2020','#f07020','#e03050','#d0a800','#30c020','#8040c0'];

function cacheSet(cache, key, sprite) {
  if (cache.size >= MAX_SPRITE_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, sprite);
  return sprite;
}

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

// ─── Segment sprite caches (Snake head + body) ───────────────────────────────
const segSpriteCache = new Map();

// Body segment: (CELL+4)×(CELL+4) green oval with belly stripe.
function buildSnakeBodySprite() {
  const dpr = window.devicePixelRatio || 1;
  const key = `snakebody:${dpr}`;
  if (segSpriteCache.has(key)) return segSpriteCache.get(key);

  const W  = CELL + 4;   // 24 logical px
  const CR = W / 2;      // 12
  const r  = CELL / 2 + 0.8;

  const off = document.createElement('canvas');
  off.width  = W * dpr;
  off.height = W * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  // Green radial gradient body
  const bodyGrad = cx.createRadialGradient(CR - 1, CR - 1, 0, CR, CR, r);
  bodyGrad.addColorStop(0,    '#5a9a38');
  bodyGrad.addColorStop(0.5,  '#4a7a2e');
  bodyGrad.addColorStop(0.85, '#2d4a1e');
  bodyGrad.addColorStop(1,    'rgba(20,36,12,0)');
  cx.fillStyle = bodyGrad;
  cx.beginPath();
  cx.arc(CR, CR, r, 0, Math.PI * 2);
  cx.fill();

  // Belly stripe (pale cream centre line)
  const bellyGrad = cx.createLinearGradient(CR - 3, CR, CR + 3, CR);
  bellyGrad.addColorStop(0,   'rgba(232,221,184,0)');
  bellyGrad.addColorStop(0.4, 'rgba(232,221,184,0.35)');
  bellyGrad.addColorStop(0.6, 'rgba(232,221,184,0.35)');
  bellyGrad.addColorStop(1,   'rgba(232,221,184,0)');
  cx.fillStyle = bellyGrad;
  cx.beginPath();
  cx.ellipse(CR, CR, 2.5, r * 0.85, 0, 0, Math.PI * 2);
  cx.fill();

  if (segSpriteCache.size >= MAX_SPRITE_CACHE) segSpriteCache.delete(segSpriteCache.keys().next().value);
  segSpriteCache.set(key, off);
  return off;
}

// Snake head: CELL×CELL, designed pointing UP (nose tip at y=0).
// drawFrame rotates it to face the direction of movement.
function buildSnakeHeadSprite() {
  const dpr = window.devicePixelRatio || 1;
  const key = `snakehead:${dpr}`;
  if (segSpriteCache.has(key)) return segSpriteCache.get(key);

  const C  = CELL;   // 20
  const HC = C / 2;  // 10

  const off = document.createElement('canvas');
  off.width  = C * dpr;
  off.height = C * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  // Hood flare (widest part, near neck)
  const hoodGrad = cx.createLinearGradient(0, C * 0.4, 0, C * 0.9);
  hoodGrad.addColorStop(0, '#3a6a20');
  hoodGrad.addColorStop(1, '#2a4a14');
  cx.fillStyle = hoodGrad;
  cx.beginPath();
  cx.ellipse(HC, C * 0.65, HC * 0.90, C * 0.38, 0, 0, Math.PI * 2);
  cx.fill();

  // Head body (narrows from hood to snout tip)
  const headGrad = cx.createLinearGradient(HC - 8, 0, HC + 8, 0);
  headGrad.addColorStop(0,   '#2a4a14');
  headGrad.addColorStop(0.5, '#4a7a2e');
  headGrad.addColorStop(1,   '#2a4a14');
  cx.fillStyle = headGrad;
  cx.beginPath();
  cx.moveTo(HC, 0);  // nose tip
  cx.bezierCurveTo(HC + 5, C * 0.18, HC + 8, C * 0.45, HC + 8, C * 0.68);
  cx.lineTo(HC - 8, C * 0.68);
  cx.bezierCurveTo(HC - 8, C * 0.45, HC - 5, C * 0.18, HC, 0);
  cx.closePath();
  cx.fill();

  // Belly stripe (pale cream centre down the snout)
  const bellyGrad = cx.createLinearGradient(HC - 3, 0, HC + 3, 0);
  bellyGrad.addColorStop(0,   'rgba(232,221,184,0)');
  bellyGrad.addColorStop(0.3, 'rgba(232,221,184,0.55)');
  bellyGrad.addColorStop(0.7, 'rgba(232,221,184,0.55)');
  bellyGrad.addColorStop(1,   'rgba(232,221,184,0)');
  cx.fillStyle = bellyGrad;
  cx.beginPath();
  cx.moveTo(HC, C * 0.05);
  cx.bezierCurveTo(HC + 2.5, C * 0.22, HC + 2, C * 0.5, HC + 1.5, C * 0.68);
  cx.lineTo(HC - 1.5, C * 0.68);
  cx.bezierCurveTo(HC - 2, C * 0.5, HC - 2.5, C * 0.22, HC, C * 0.05);
  cx.closePath();
  cx.fill();

  // Scale V-marks
  cx.strokeStyle = 'rgba(20,40,10,0.55)';
  cx.lineWidth   = 0.7;
  cx.lineCap     = 'round';
  for (let row = 0; row < 3; row++) {
    const vy = C * (0.36 + row * 0.14);
    const vw = 3.8 - row * 0.5;
    cx.beginPath();
    cx.moveTo(HC - vw, vy);
    cx.lineTo(HC, vy + 1.5);
    cx.lineTo(HC + vw, vy);
    cx.stroke();
  }

  // Eyes: yellow ellipse + dark vertical slit
  for (const s of [-1, 1]) {
    const ex = HC + s * 3.8;
    const ey = C * 0.27;
    cx.fillStyle = '#d4b820';
    cx.beginPath();
    cx.ellipse(ex, ey, 2.4, 1.8, 0, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = '#0a0a0a';
    cx.beginPath();
    cx.ellipse(ex, ey, 0.65, 1.6, 0, 0, Math.PI * 2);
    cx.fill();
  }

  if (segSpriteCache.size >= MAX_SPRITE_CACHE) segSpriteCache.delete(segSpriteCache.keys().next().value);
  segSpriteCache.set(key, off);
  return off;
}

// ─── Fruit sprite cache (6 random fruits, each CELL×CELL) ────────────────────
const fruitSpriteCache = new Map();

function buildFruitSprite(type) {
  const dpr = window.devicePixelRatio || 1;
  const key = `fruit:${type}:${dpr}`;
  if (fruitSpriteCache.has(key)) return fruitSpriteCache.get(key);

  const S  = CELL;   // 20 logical px
  const HC = S / 2;  // 10

  const off = document.createElement('canvas');
  off.width  = S * dpr;
  off.height = S * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  switch (type) {
    case 0: {  // Apple — red with two lobes, stem, leaf
      const g = cx.createRadialGradient(HC - 2, HC - 1, 1, HC, HC + 1, 9);
      g.addColorStop(0, '#f05050');
      g.addColorStop(0.6, '#d42020');
      g.addColorStop(1, '#a01010');
      cx.fillStyle = g;
      // Two-lobe silhouette
      cx.beginPath(); cx.arc(HC - 2.5, HC - 4, 4, 0, Math.PI * 2); cx.fill();
      cx.beginPath(); cx.arc(HC + 2.5, HC - 4, 4, 0, Math.PI * 2); cx.fill();
      cx.beginPath(); cx.arc(HC, HC + 2, 7, 0, Math.PI * 2);       cx.fill();
      // Stem
      cx.strokeStyle = '#5a3010'; cx.lineWidth = 1.2; cx.lineCap = 'round';
      cx.beginPath(); cx.moveTo(HC, HC - 7); cx.lineTo(HC + 1, HC - 10); cx.stroke();
      // Leaf
      cx.fillStyle = '#30a020';
      cx.beginPath(); cx.ellipse(HC + 3, HC - 9, 3, 1.4, -0.6, 0, Math.PI * 2); cx.fill();
      break;
    }
    case 1: {  // Orange — gradient sphere with navel
      const g = cx.createRadialGradient(HC - 2, HC - 2, 1, HC, HC, 9);
      g.addColorStop(0, '#ffb050'); g.addColorStop(0.6, '#f07020'); g.addColorStop(1, '#c05010');
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(HC, HC, 8.5, 0, Math.PI * 2); cx.fill();
      // Navel
      cx.fillStyle = 'rgba(160,60,0,0.35)';
      cx.beginPath(); cx.arc(HC + 2, HC + 1, 1.5, 0, Math.PI * 2); cx.fill();
      // Stem nub
      cx.fillStyle = '#5a6020';
      cx.beginPath(); cx.arc(HC, HC - 8, 1.5, 0, Math.PI * 2); cx.fill();
      break;
    }
    case 2: {  // Strawberry — heart body with seeds + leaves
      cx.fillStyle = '#e02040';
      cx.beginPath(); cx.arc(HC - 2.5, HC - 2, 4.5, 0, Math.PI * 2); cx.fill();
      cx.beginPath(); cx.arc(HC + 2.5, HC - 2, 4.5, 0, Math.PI * 2); cx.fill();
      cx.beginPath();
      cx.moveTo(HC - 6.5, HC - 1); cx.lineTo(HC, HC + 8); cx.lineTo(HC + 6.5, HC - 1);
      cx.closePath(); cx.fill();
      // Seeds
      cx.fillStyle = '#fff0d0';
      for (const [sx, sy] of [[-2,-1],[2,-1],[0,2],[-3,2],[3,2],[0,5]]) {
        cx.beginPath(); cx.arc(HC + sx, HC + sy, 0.8, 0, Math.PI * 2); cx.fill();
      }
      // Leaves
      cx.fillStyle = '#30a020';
      for (const [lx, ly, la] of [[-2,-6,-0.5],[0,-7.5,0],[2,-6,0.5]]) {
        cx.beginPath(); cx.ellipse(HC + lx, HC + ly, 1.2, 2.5, la, 0, Math.PI * 2); cx.fill();
      }
      break;
    }
    case 3: {  // Banana — yellow crescent
      cx.strokeStyle = '#f0c010'; cx.lineWidth = 5; cx.lineCap = 'round';
      cx.beginPath();
      cx.moveTo(HC - 7, HC + 5);
      cx.quadraticCurveTo(HC + 2, HC - 10, HC + 8, HC + 4);
      cx.stroke();
      // Dark edge
      cx.strokeStyle = '#c08000'; cx.lineWidth = 1.2;
      cx.beginPath();
      cx.moveTo(HC - 7, HC + 5);
      cx.quadraticCurveTo(HC + 2, HC - 10, HC + 8, HC + 4);
      cx.stroke();
      // Inner highlight
      cx.strokeStyle = 'rgba(255,240,170,0.65)'; cx.lineWidth = 1.5;
      cx.beginPath();
      cx.moveTo(HC - 5, HC + 4);
      cx.quadraticCurveTo(HC + 2, HC - 7, HC + 6, HC + 3);
      cx.stroke();
      break;
    }
    case 4: {  // Watermelon slice — top-half arc view
      // Green rind
      cx.fillStyle = '#30a020';
      cx.beginPath(); cx.arc(HC, HC + 1, 9, Math.PI, 0); cx.closePath(); cx.fill();
      // White rind
      cx.fillStyle = '#f0f0e0';
      cx.beginPath(); cx.arc(HC, HC + 1, 7.5, Math.PI, 0); cx.closePath(); cx.fill();
      // Red flesh
      cx.fillStyle = '#e02040';
      cx.beginPath(); cx.arc(HC, HC + 1, 6.5, Math.PI, 0); cx.closePath(); cx.fill();
      // Seeds
      cx.fillStyle = '#1a1010';
      for (const [sx, sy] of [[-3,-1],[0,-3],[3,-1],[-1.5,-4],[1.5,-4]]) {
        cx.beginPath(); cx.ellipse(HC + sx, HC + sy, 0.8, 1.2, 0.3, 0, Math.PI * 2); cx.fill();
      }
      break;
    }
    case 5: {  // Grape — cluster of 6 purple circles
      for (const [gx, gy] of [[-3.5,3],[3.5,3],[0,3],[-2.5,-1],[2.5,-1],[0,-5]]) {
        const gg = cx.createRadialGradient(HC + gx - 0.8, HC + gy - 0.8, 0.5, HC + gx, HC + gy, 3.5);
        gg.addColorStop(0, '#a060d0'); gg.addColorStop(0.6, '#7030a0'); gg.addColorStop(1, '#4a1a70');
        cx.fillStyle = gg;
        cx.beginPath(); cx.arc(HC + gx, HC + gy, 3.5, 0, Math.PI * 2); cx.fill();
      }
      // Stem
      cx.strokeStyle = '#5a3010'; cx.lineWidth = 1; cx.lineCap = 'round';
      cx.beginPath(); cx.moveTo(HC, HC - 8); cx.lineTo(HC + 2, HC - 10); cx.stroke();
      break;
    }
  }

  return cacheSet(fruitSpriteCache, key, off);
}

// ─── Frame renderer ───────────────────────────────────────────────────────────

/**
 * Render one frame to `canvas`.
 *
 * animRef holds all inter-frame mutable state:
 *   Head interpolation : prevCell, startMs, headIdx
 *   Eat detection      : prevFood
 *   State detection    : prevState
 *   Effects            : particles[], scorePopups[], eatFlash, shake, dustParticles[]
 *
 * stateRef       — mirrors App state string for death-shake trigger
 * scoreRef       — not currently read (score is always +10), kept for future use
 * levelIndexRef  — mirrors levelIndex prop for level-color effects in rAF loop
 */
function drawFrame(canvas, headIdxRef, snakeLenRef, foodRef, animRef, stateRef, scoreRef, levelIndexRef) { // eslint-disable-line no-unused-vars
  const dpr = window.devicePixelRatio || 1;
  const now = performance.now();

  if (canvas.width !== SIZE * dpr || canvas.height !== SIZE * dpr) {
    canvas.width  = SIZE * dpr;
    canvas.height = SIZE * dpr;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const anim       = animRef.current;
  const food       = foodRef.current;
  const headIdx    = headIdxRef.current;
  const snakeLen   = snakeLenRef.current;
  const levelIdx   = levelIndexRef.current;
  const levelColor = LEVELS[levelIdx]?.color ?? '#4ecca3';

  // ── Detect food eat (food position change = food was consumed) ────────────
  if (anim.prevFood === null) {
    anim.prevFood = { x: food.x, y: food.y };
  } else if (anim.prevFood.x !== food.x || anim.prevFood.y !== food.y) {
    const oldFx = anim.prevFood.x * CELL + CELL / 2;
    const oldFy = anim.prevFood.y * CELL + CELL / 2;

    // Particle burst — 12 pieces radiating outward from eaten-food position
    for (let i = 0; i < 12; i++) {
      const a   = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const spd = 1.2 + Math.random() * 2;
      anim.particles.push({
        x: oldFx, y: oldFy,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        r: 2 + Math.random() * 1.5,
        color: levelColor,
        startMs: now, duration: 500,
      });
    }

    // Floating "+10" text rising from food position
    anim.scorePopups.push({
      x: oldFx, y: oldFy,
      text: '+10',
      color: levelColor,
      startMs: now, duration: 700,
    });

    // Expanding ring flash at eaten-food position
    anim.eatFlash = { x: oldFx, y: oldFy, color: levelColor, startMs: now, duration: 220 };

    anim.prevFood = { x: food.x, y: food.y };
  }

  // ── Detect death → trigger screen shake ───────────────────────────────────
  const currentState = stateRef.current;
  if (currentState === 'dead' && anim.prevState !== 'dead') {
    anim.shake = { startMs: now, duration: 500 };
  }
  anim.prevState = currentState;

  // ── Compute screen shake offset ───────────────────────────────────────────
  let shakeX = 0, shakeY = 0;
  if (anim.shake) {
    const st = (now - anim.shake.startMs) / anim.shake.duration;
    if (st >= 1) {
      anim.shake = null;
    } else {
      const amp = 6 * (1 - st);
      shakeX = amp * Math.sin(st * 40);
      shakeY = amp * Math.cos(st * 38);
    }
  }

  // Apply DPR scale then shake translate (all drawing inside this block is offset)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  ctx.translate(shakeX, shakeY);

  // ── Layer 1: floor ────────────────────────────────────────────────────────
  const grid = getGridCanvas();
  if (!grid) { ctx.restore(); return; }
  ctx.drawImage(grid, 0, 0, SIZE, SIZE);

  // ── Vignette — dark radial overlay to frame and add depth ────────────────
  const vig = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.28, SIZE / 2, SIZE / 2, SIZE * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Ambient dust — faint drifting motes in the sky band ──────────────────
  for (const d of anim.dustParticles) {
    d.x += d.vx;
    d.y += d.vy;
    if (d.y > SIZE * 0.22) d.y = 0;
    if (d.x < 0) d.x = SIZE;
    if (d.x > SIZE) d.x = 0;
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = '#e8d4a0';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Head interpolation ────────────────────────────────────────────────────
  if (headIdx !== anim.headIdx) {
    // Measure tick interval to set interpolation duration proportionally
    if (anim.lastTickMs !== null) {
      const measured = now - anim.lastTickMs;
      // 88% of tick interval: head reaches destination with ~1 frame to spare
      anim.interpDuration = Math.min(Math.max(measured * 0.88, 40), 400);
    }
    anim.lastTickMs = now;

    if (anim.headIdx >= 0 && snakeLen > 1) {
      const oldHead = segPool[(headIdx + 1) % POOL_SIZE];
      anim.prevCell = { x: oldHead.x, y: oldHead.y };
    } else {
      const cur = segPool[headIdx % POOL_SIZE];
      anim.prevCell = { x: cur.x, y: cur.y };
    }
    anim.startMs = now;
    anim.headIdx = headIdx;
  }

  const head    = segPool[headIdx % POOL_SIZE];
  const elapsed = now - anim.startMs;
  const t       = Math.min(1, elapsed / anim.interpDuration);

  const dxRaw = head.x - anim.prevCell.x;
  const dyRaw = head.y - anim.prevCell.y;
  const skip  = Math.abs(dxRaw) > 1 || Math.abs(dyRaw) > 1;
  const hxF   = skip ? head.x : anim.prevCell.x + dxRaw * t;
  const hyF   = skip ? head.y : anim.prevCell.y + dyRaw * t;

  // ── Layer 2: food (random fruit) ─────────────────────────────────────────
  const fx = food.x * CELL + CELL / 2;
  const fy = food.y * CELL + CELL / 2;
  const fruitType = food.type ?? 0;

  const foodGlow = buildGlowSprite(FRUIT_GLOW_COLORS[fruitType], FOOD_RADIUS, FOOD_GLOW);
  if (foodGlow) {
    ctx.globalAlpha = 0.45;
    ctx.drawImage(foodGlow, fx - FOOD_TOTAL, fy - FOOD_TOTAL, FOOD_TOTAL * 2, FOOD_TOTAL * 2);
    ctx.globalAlpha = 1;
  }
  const foodSpr = buildFruitSprite(fruitType);
  if (foodSpr) {
    ctx.drawImage(foodSpr, food.x * CELL, food.y * CELL, CELL, CELL);
  }

  // ── Layer 3: snake body (tail → neck, back-to-front) ─────────────────────
  const bodySprite = buildSnakeBodySprite();
  const SW = CELL + 4;
  for (let i = snakeLen - 1; i >= 1; i--) {
    const seg = segPool[(headIdx + i) % POOL_SIZE];
    const scx = seg.x * CELL + CELL / 2;
    const scy = seg.y * CELL + CELL / 2;
    if (bodySprite) ctx.drawImage(bodySprite, scx - SW / 2, scy - SW / 2, SW, SW);
  }
  ctx.globalAlpha = 1;

  // ── Layer 4: head ─────────────────────────────────────────────────────────
  const hcx = hxF * CELL + CELL / 2;
  const hcy = hyF * CELL + CELL / 2;

  let dirX = 0, dirY = -1;
  if (snakeLen > 1) {
    const neck = segPool[(headIdx + 1) % POOL_SIZE];
    const rx   = head.x - neck.x;
    const ry   = head.y - neck.y;
    dirX = Math.abs(rx) > 1 ? -Math.sign(rx) : rx;
    dirY = Math.abs(ry) > 1 ? -Math.sign(ry) : ry;
  }
  const angle = Math.atan2(dirY, dirX) + Math.PI / 2;

  // Static head-glow halo
  const headGlow = buildGlowSprite('#40a020', HEAD_RADIUS, HEAD_GLOW);
  if (headGlow) {
    ctx.globalAlpha = 0.50;
    ctx.drawImage(headGlow, hcx - HEAD_TOTAL, hcy - HEAD_TOTAL, HEAD_TOTAL * 2, HEAD_TOTAL * 2);
    ctx.globalAlpha = 1;
  }

  // Rotated snake head sprite
  const headSprite = buildSnakeHeadSprite();
  if (headSprite) {
    ctx.save();
    ctx.translate(hcx, hcy);
    ctx.rotate(angle);
    ctx.drawImage(headSprite, -CELL / 2, -CELL / 2, CELL, CELL);
    ctx.restore();
  }

  // Tongue flicker
  const tongueOut = Math.sin(now * 0.010) > 0.2;
  if (tongueOut) {
    const tLen   = 4 + Math.sin(now * 0.022) * 1.5;
    const mouthX = hcx + dirX * CELL * 0.46;
    const mouthY = hcy + dirY * CELL * 0.46;
    const perpX  = -dirY, perpY = dirX;
    ctx.strokeStyle = '#e02020';
    ctx.lineWidth   = 0.9;
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.85;
    for (const fork of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(mouthX, mouthY);
      ctx.lineTo(mouthX + dirX * tLen + perpX * fork * 2, mouthY + dirY * tLen + perpY * fork * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Effects layer (drawn on top of everything) ────────────────────────────

  // Eat flash ring — expanding circle that fades out
  if (anim.eatFlash) {
    const ft = (now - anim.eatFlash.startMs) / anim.eatFlash.duration;
    if (ft >= 1) {
      anim.eatFlash = null;
    } else {
      ctx.globalAlpha = 0.7 * (1 - ft);
      ctx.strokeStyle = anim.eatFlash.color;
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.arc(anim.eatFlash.x, anim.eatFlash.y, 10 + 12 * ft, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth   = 1;
    }
  }

  // Particles — drawn and mutated in-place; expired ones are removed
  anim.particles = anim.particles.filter(p => {
    const pt = (now - p.startMs) / p.duration;
    if (pt >= 1) return false;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.06;  // light gravity
    ctx.globalAlpha = (1 - pt) * 0.9;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (1 - pt * 0.6), 0, Math.PI * 2);
    ctx.fill();
    return true;
  });
  ctx.globalAlpha = 1;

  // Score pop-ups — float upward and fade
  anim.scorePopups = anim.scorePopups.filter(sp => {
    const st = (now - sp.startMs) / sp.duration;
    if (st >= 1) return false;
    const sa = st < 0.25 ? 1 : 1 - (st - 0.25) / 0.75;
    ctx.globalAlpha  = sa;
    ctx.fillStyle    = sp.color;
    ctx.font         = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sp.text, sp.x, sp.y - 30 * st);
    return true;
  });
  ctx.globalAlpha  = 1;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.restore();  // end shake translate
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Props:
 *   headIdxRef  MutableRefObject<number>   — pool head index from useSnake
 *   snakeLenRef MutableRefObject<number>   — live segment count from useSnake
 *   foodRef     MutableRefObject<{x,y}>    — food position from useSnake
 *   levelIndex  number                     — selects border accent color + effect colors
 *   stateRef    MutableRefObject<string>   — mirrors game state for death-shake trigger
 *   scoreRef    MutableRefObject<number>   — mirrors score (reserved for future effects)
 */
export function GameCanvas({ headIdxRef, snakeLenRef, foodRef, levelIndex, stateRef, scoreRef }) {
  const canvasRef = useRef(null);
  const color     = LEVELS[levelIndex]?.color ?? '#4ecca3';

  // levelIndexRef lets drawFrame read the latest levelIndex without restarting the loop
  const levelIndexRef = useRef(levelIndex);
  useEffect(() => { levelIndexRef.current = levelIndex; }, [levelIndex]);

  // All mutable per-frame state in one ref — avoids React state overhead on every tick.
  // dustParticles are initialized here once (Math.random values fixed at mount).
  const animRef = useRef({
    // Head interpolation
    prevCell: { x: 0, y: 0 }, startMs: 0, headIdx: -1, lastTickMs: null, interpDuration: 270,
    // Eat / state detection
    prevFood: null, prevState: 'idle',
    // Active effects
    particles: [], scorePopups: [], eatFlash: null, shake: null,
    // Ambient dust: 10 faint motes drifting through the sky band
    dustParticles: Array.from({ length: 10 }, () => ({
      x:     Math.random() * SIZE,
      y:     Math.random() * SIZE * 0.22,
      vx:    (Math.random() - 0.5) * 0.06,
      vy:    0.02 + Math.random() * 0.04,
      r:     0.8 + Math.random() * 1.2,
      alpha: 0.04 + Math.random() * 0.06,
    })),
  });

  // rAF loop runs for the component's lifetime; all game data is read from refs.
  useEffect(() => {
    let rafId;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          drawFrame(canvas, headIdxRef, snakeLenRef, foodRef, animRef, stateRef, scoreRef, levelIndexRef);
        } catch (err) {
          console.error('[GameCanvas] drawFrame threw — stopping rAF loop:', err);
          stopped = true;
          return;
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => { stopped = true; cancelAnimationFrame(rafId); };
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
