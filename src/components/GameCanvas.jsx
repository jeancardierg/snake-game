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
const FOOD_PAD    = 8;                           // portrait overhang — gives room for suit below face
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

  // ── Alborz mountain silhouette (rows 1–4) ────────────────────────────────────
  // Three overlapping ridgelines in receding blue-grey tones.
  const ridges = [
    { yBase: skyH * 1.05, amp: 38, freq: 0.018, color: '#7a8fa0', alpha: 0.82 },  // far ridge
    { yBase: skyH * 0.88, amp: 28, freq: 0.024, color: '#91a3b5', alpha: 0.70 },  // mid ridge
    { yBase: skyH * 0.72, amp: 20, freq: 0.032, color: '#a8bbc9', alpha: 0.55 },  // near ridge
  ];

  for (const ridge of ridges) {
    ctx.save();
    ctx.globalAlpha = ridge.alpha;
    ctx.fillStyle   = ridge.color;
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    for (let x = 0; x <= SIZE; x += 2) {
      // Stack three sine harmonics for natural-looking peaks
      const y = ridge.yBase
        - Math.sin(x * ridge.freq + 0.8)         * ridge.amp
        - Math.sin(x * ridge.freq * 2.3 + 2.1)   * ridge.amp * 0.42
        - Math.sin(x * ridge.freq * 0.57 + 1.3)  * ridge.amp * 0.28;
      if (x === 0) ctx.moveTo(0, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(SIZE, SIZE);
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

// ─── Segment sprite caches (King Cobra) ──────────────────────────────────────
const segSpriteCache = new Map();

// Body: (CELL+4)×(CELL+4) smooth circle — 2px padding so adjacent circles
// overlap by 2px each side, hiding the grid seams.
function buildCobraBodySprite() {
  const dpr = window.devicePixelRatio || 1;
  const key = `cobra:b:${dpr}`;
  if (segSpriteCache.has(key)) return segSpriteCache.get(key);

  const W  = CELL + 4;   // 24 logical px
  const CR = W / 2;      // 12 — canvas centre = circle centre
  const r  = CELL / 2 + 0.8;   // radius slightly > half-cell for overlap

  const off = document.createElement('canvas');
  off.width  = W * dpr;
  off.height = W * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  // 3D-lit olive body
  const bodyGrad = cx.createRadialGradient(CR - r * 0.22, CR - r * 0.30, 0, CR, CR, r);
  bodyGrad.addColorStop(0,    '#3c4a20');   // top-lit highlight
  bodyGrad.addColorStop(0.45, '#202a10');   // mid body
  bodyGrad.addColorStop(1,    '#0c1006');   // deep rim shadow
  cx.fillStyle = bodyGrad;
  cx.beginPath();
  cx.arc(CR, CR, r, 0, Math.PI * 2);
  cx.fill();

  // Cream inter-band stripe (clipped to circle)
  cx.save();
  cx.beginPath();
  cx.arc(CR, CR, r, 0, Math.PI * 2);
  cx.clip();
  const bandGrad = cx.createLinearGradient(0, CR - 3.2, 0, CR + 3.2);
  bandGrad.addColorStop(0,   'rgba(55,48,14,0.65)');
  bandGrad.addColorStop(0.2, 'rgba(210,185,108,0.75)');
  bandGrad.addColorStop(0.8, 'rgba(210,185,108,0.75)');
  bandGrad.addColorStop(1,   'rgba(55,48,14,0.65)');
  cx.fillStyle = bandGrad;
  cx.fillRect(0, CR - 3.2, W, 6.4);
  cx.restore();

  // Soft top-lit sheen
  cx.save();
  cx.beginPath();
  cx.arc(CR, CR, r, 0, Math.PI * 2);
  cx.clip();
  const sheen = cx.createRadialGradient(CR - r * 0.22, CR - r * 0.30, 0, CR, CR, r * 0.80);
  sheen.addColorStop(0, 'rgba(175,205,125,0.18)');
  sheen.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = sheen;
  cx.fillRect(0, 0, W, W);
  cx.restore();

  if (segSpriteCache.size >= MAX_SPRITE_CACHE) segSpriteCache.delete(segSpriteCache.keys().next().value);
  segSpriteCache.set(key, off);
  return off;
}

// Head: CELL×CELL, designed with snout at y=0 (pointing UP).
// drawFrame rotates it to face the direction of movement.
function buildCobraHeadSprite() {
  const dpr = window.devicePixelRatio || 1;
  const key = `cobra:h:${dpr}`;
  if (segSpriteCache.has(key)) return segSpriteCache.get(key);

  const C  = CELL;     // 20
  const HC = C / 2;    // 10

  const off = document.createElement('canvas');
  off.width  = C * dpr;
  off.height = C * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  // ── Hood / neck (lower ~60% of sprite — behind the eyes) ─────────────────
  // Wide oval hood characteristic of a rearing King Cobra.
  const hoodGrad = cx.createRadialGradient(HC, C * 0.62, 0, HC, C * 0.62, HC * 0.95);
  hoodGrad.addColorStop(0,   '#3c4c20');
  hoodGrad.addColorStop(0.5, '#283218');
  hoodGrad.addColorStop(1,   '#151c0a');
  cx.fillStyle = hoodGrad;
  cx.beginPath();
  cx.ellipse(HC, C * 0.62, HC * 0.96, HC * 0.78, 0, 0, Math.PI * 2);
  cx.fill();

  // Spectacle marking — the iconic paired-circle pattern on the King Cobra hood
  cx.strokeStyle = 'rgba(215,190,110,0.82)';
  cx.lineWidth   = 0.9;
  cx.beginPath();
  cx.arc(HC - 3.8, C * 0.58, 3.0, Math.PI * 0.15, Math.PI * 1.85);
  cx.stroke();
  cx.beginPath();
  cx.arc(HC + 3.8, C * 0.58, 3.0, -Math.PI * 0.85, Math.PI * 0.85);
  cx.stroke();
  cx.beginPath();  // bridge between the two oculars
  cx.moveTo(HC - 1.8, C * 0.57 - 2.6);
  cx.lineTo(HC + 1.8, C * 0.57 - 2.6);
  cx.stroke();

  // Hood rim highlight for 3D depth
  cx.strokeStyle = 'rgba(75,95,38,0.55)';
  cx.lineWidth   = 0.65;
  cx.beginPath();
  cx.ellipse(HC, C * 0.62, HC * 0.93, HC * 0.74, 0, Math.PI * 1.08, Math.PI * 2.0);
  cx.stroke();

  // ── Head / face (pointed oval, snout toward y=0) ──────────────────────────
  const faceGrad = cx.createRadialGradient(HC, C * 0.30, 0, HC, C * 0.38, HC * 0.68);
  faceGrad.addColorStop(0,   '#4e5e2a');
  faceGrad.addColorStop(0.5, '#333f1a');
  faceGrad.addColorStop(1,   '#1c2410');
  cx.fillStyle = faceGrad;
  cx.beginPath();
  cx.ellipse(HC, C * 0.38, HC * 0.60, HC * 0.52, 0, 0, Math.PI * 2);
  cx.fill();

  // ── Eyes — large, detailed, realistic ────────────────────────────────────
  const eyeY  = C * 0.40;
  const eyeOX = HC * 0.72;
  for (const sign of [-1, 1]) {
    const ex = HC + sign * eyeOX;

    // Dark bony eye socket
    cx.fillStyle = '#0a0d05';
    cx.beginPath();
    cx.ellipse(ex, eyeY, 3.0, 2.4, 0, 0, Math.PI * 2);
    cx.fill();

    // Amber-gold iris with radial gradient (bright inner, dark outer limbus)
    const iris = cx.createRadialGradient(ex - sign * 0.4, eyeY - 0.4, 0, ex, eyeY, 2.4);
    iris.addColorStop(0,   '#ffe040');
    iris.addColorStop(0.4, '#cc8800');
    iris.addColorStop(1,   '#5c2e00');
    cx.fillStyle = iris;
    cx.beginPath();
    cx.ellipse(ex, eyeY, 2.4, 1.9, 0, 0, Math.PI * 2);
    cx.fill();

    // Vertical slit pupil
    cx.fillStyle = '#050302';
    cx.beginPath();
    cx.ellipse(ex, eyeY, 0.58, 1.65, 0, 0, Math.PI * 2);
    cx.fill();

    // Primary corneal highlight (bright, tight)
    cx.fillStyle = 'rgba(255,248,205,0.85)';
    cx.beginPath();
    cx.ellipse(ex - sign * 0.65, eyeY - 0.70, 0.65, 0.40, -0.4, 0, Math.PI * 2);
    cx.fill();

    // Secondary diffuse reflection
    cx.fillStyle = 'rgba(255,240,180,0.28)';
    cx.beginPath();
    cx.ellipse(ex + sign * 0.35, eyeY + 0.55, 0.32, 0.22, 0.3, 0, Math.PI * 2);
    cx.fill();
  }

  // ── Nostrils ──────────────────────────────────────────────────────────────
  cx.fillStyle = 'rgba(0,0,0,0.55)';
  for (const nx of [HC - 1.6, HC + 1.6]) {
    cx.beginPath();
    cx.ellipse(nx, C * 0.20, 0.75, 0.52, 0.3, 0, Math.PI * 2);
    cx.fill();
  }

  // Snout scale highlight
  cx.fillStyle = 'rgba(110,140,65,0.28)';
  cx.beginPath();
  cx.ellipse(HC, C * 0.10, 2.6, 1.9, 0, 0, Math.PI * 2);
  cx.fill();

  // ── Forked tongue (extends from snout toward y<0, clipped at edge) ───────
  cx.strokeStyle = '#dd1010';
  cx.lineWidth   = 0.80;
  cx.lineCap     = 'round';
  // Stem
  cx.beginPath();
  cx.moveTo(HC, C * 0.04);
  cx.lineTo(HC, -1);
  cx.stroke();
  // Left fork
  cx.beginPath();
  cx.moveTo(HC, C * 0.04);
  cx.lineTo(HC - 2.8, -2.5);
  cx.stroke();
  // Right fork
  cx.beginPath();
  cx.moveTo(HC, C * 0.04);
  cx.lineTo(HC + 2.8, -2.5);
  cx.stroke();

  if (segSpriteCache.size >= MAX_SPRITE_CACHE) segSpriteCache.delete(segSpriteCache.keys().next().value);
  segSpriteCache.set(key, off);
  return off;
}

// ─── Food sprite cache (Trump portrait — head to armpit) ──────────────────────
// 36×36 px canvas (CELL=20 + FOOD_PAD*2=16) showing hair, face, neck,
// navy suit shoulders, white shirt and red tie.
const foodSpriteCache = new Map();

function buildTrumpSprite() {
  const dpr = window.devicePixelRatio || 1;
  const key = `trump:${dpr}`;
  if (foodSpriteCache.has(key)) return foodSpriteCache.get(key);

  const S  = CELL + FOOD_PAD * 2;   // 36 logical px
  const CX = S / 2;                 // 18 — horizontal centre
  const CY = 14;                    // face centre (upper half of canvas)
  const R  = 8;                     // face radius

  const off = document.createElement('canvas');
  off.width  = S * dpr;
  off.height = S * dpr;
  const cx   = off.getContext('2d');
  if (!cx) return null;
  cx.scale(dpr, dpr);

  // ── Drop shadow (behind the whole portrait) ───────────────────────────────
  const shadow = cx.createRadialGradient(CX + 1, CY + 2, 0, CX + 1, CY + 3, R + 6);
  shadow.addColorStop(0, 'rgba(0,0,0,0.40)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = shadow;
  cx.fillRect(0, 0, S, S);

  // ══ SUIT (drawn first — everything else overlays it) ═════════════════════

  // ── Jacket body — wide navy trapezoid filling lower portion ──────────────
  cx.fillStyle = '#1c3472';
  cx.beginPath();
  cx.moveTo(0,       S);         // bottom-left corner
  cx.lineTo(S,       S);         // bottom-right corner
  cx.lineTo(S,       CY + 10);   // right armpit
  cx.lineTo(CX + 12, CY + 6);    // right shoulder slope
  cx.lineTo(CX + 6,  CY + 3);    // right collar
  cx.lineTo(CX - 6,  CY + 3);    // left collar
  cx.lineTo(CX - 12, CY + 6);    // left shoulder slope
  cx.lineTo(0,       CY + 10);   // left armpit
  cx.closePath();
  cx.fill();

  // Jacket side shadow (darker edges for 3D depth)
  const jacketShade = cx.createLinearGradient(0, 0, S, 0);
  jacketShade.addColorStop(0,    'rgba(10,18,50,0.55)');
  jacketShade.addColorStop(0.25, 'rgba(0,0,0,0)');
  jacketShade.addColorStop(0.75, 'rgba(0,0,0,0)');
  jacketShade.addColorStop(1,    'rgba(10,18,50,0.55)');
  cx.fillStyle = jacketShade;
  cx.fillRect(0, CY + 3, S, S - CY - 3);

  // ── Left lapel (folded-back — lighter inner face visible) ─────────────────
  cx.fillStyle = '#243a80';
  cx.beginPath();
  cx.moveTo(CX - 6,  CY + 3);    // top (collar notch)
  cx.lineTo(CX - 12, CY + 8);    // outer shoulder edge
  cx.lineTo(CX - 5,  CY + 18);   // lapel point
  cx.lineTo(CX - 3,  CY + 5);    // inner edge meets shirt
  cx.closePath();
  cx.fill();
  // Lapel inner shadow
  cx.fillStyle = 'rgba(10,18,50,0.30)';
  cx.beginPath();
  cx.moveTo(CX - 6,  CY + 3);
  cx.lineTo(CX - 10, CY + 8);
  cx.lineTo(CX - 5,  CY + 18);
  cx.lineTo(CX - 3,  CY + 5);
  cx.closePath();
  cx.fill();

  // ── Right lapel ───────────────────────────────────────────────────────────
  cx.fillStyle = '#243a80';
  cx.beginPath();
  cx.moveTo(CX + 6,  CY + 3);
  cx.lineTo(CX + 12, CY + 8);
  cx.lineTo(CX + 5,  CY + 18);
  cx.lineTo(CX + 3,  CY + 5);
  cx.closePath();
  cx.fill();
  cx.fillStyle = 'rgba(10,18,50,0.30)';
  cx.beginPath();
  cx.moveTo(CX + 6,  CY + 3);
  cx.lineTo(CX + 10, CY + 8);
  cx.lineTo(CX + 5,  CY + 18);
  cx.lineTo(CX + 3,  CY + 5);
  cx.closePath();
  cx.fill();

  // ── White shirt (visible in the V between lapels) ─────────────────────────
  cx.fillStyle = '#f0ede8';
  cx.beginPath();
  cx.moveTo(CX - 3,  CY + 4);   // left collar
  cx.lineTo(CX,      CY + 20);  // bottom V point
  cx.lineTo(CX + 3,  CY + 4);   // right collar
  cx.closePath();
  cx.fill();
  // Shirt shadow at edges
  const shirtShade = cx.createLinearGradient(CX - 3, 0, CX + 3, 0);
  shirtShade.addColorStop(0,   'rgba(160,150,130,0.30)');
  shirtShade.addColorStop(0.5, 'rgba(0,0,0,0)');
  shirtShade.addColorStop(1,   'rgba(160,150,130,0.30)');
  cx.fillStyle = shirtShade;
  cx.beginPath();
  cx.moveTo(CX - 3, CY + 4);
  cx.lineTo(CX,     CY + 20);
  cx.lineTo(CX + 3, CY + 4);
  cx.closePath();
  cx.fill();

  // ── Red tie — runs down the shirt opening ────────────────────────────────
  cx.fillStyle = '#dd0000';
  cx.beginPath();
  cx.moveTo(CX - 2.5, CY + 5);    // knot top-left
  cx.lineTo(CX + 2.5, CY + 5);    // knot top-right
  cx.lineTo(CX + 3.2, CY + 10);   // blade widens slightly
  cx.lineTo(CX + 2.0, CY + 20);   // blade
  cx.lineTo(CX,       CY + 23);   // pointed tip (below shirt V)
  cx.lineTo(CX - 2.0, CY + 20);
  cx.lineTo(CX - 3.2, CY + 10);
  cx.closePath();
  cx.fill();
  // Tie highlight stripe
  cx.fillStyle = 'rgba(255,100,100,0.38)';
  cx.beginPath();
  cx.moveTo(CX - 0.8, CY + 5.5);
  cx.lineTo(CX + 0.8, CY + 5.5);
  cx.lineTo(CX + 0.6, CY + 19);
  cx.lineTo(CX - 0.6, CY + 19);
  cx.closePath();
  cx.fill();

  // ══ HAIR ══════════════════════════════════════════════════════════════════

  // Back mass: wide sweep right, above and behind the face
  cx.fillStyle = '#f0c020';
  cx.beginPath();
  cx.ellipse(CX + 2, CY - 7, 15, 8, -0.18, 0, Math.PI * 2);
  cx.fill();

  // Right-side puff: spills to the right beyond face
  cx.fillStyle = '#e8b818';
  cx.beginPath();
  cx.ellipse(CX + 9, CY - 1, 5, 9, 0.22, 0, Math.PI * 2);
  cx.fill();

  // Front forelock flip
  cx.fillStyle = '#f8d030';
  cx.beginPath();
  cx.ellipse(CX - 1, CY - 5, 9, 4.5, 0.10, 0, Math.PI * 2);
  cx.fill();

  // Hair highlight
  const hairLight = cx.createRadialGradient(CX, CY - 9, 0, CX, CY - 6, 12);
  hairLight.addColorStop(0,   'rgba(255,248,165,0.78)');
  hairLight.addColorStop(0.6, 'rgba(240,195,20,0)');
  cx.fillStyle = hairLight;
  cx.beginPath();
  cx.ellipse(CX + 1, CY - 7, 14, 7.5, -0.18, 0, Math.PI * 2);
  cx.fill();

  // ══ FACE ══════════════════════════════════════════════════════════════════

  cx.save();
  cx.beginPath();
  cx.ellipse(CX, CY, R, R * 0.93, 0, 0, Math.PI * 2);
  cx.clip();

  // Orange skin
  const skin = cx.createRadialGradient(CX - R * 0.28, CY - R * 0.28, 0, CX, CY, R);
  skin.addColorStop(0,    '#ffc070');
  skin.addColorStop(0.40, '#f07028');
  skin.addColorStop(1,    '#c05010');
  cx.fillStyle = skin;
  cx.fillRect(CX - R - 1, CY - R - 1, R * 2 + 2, R * 2 + 2);

  // Jowl shadow
  const jowl = cx.createLinearGradient(CX, CY + R * 0.3, CX, CY + R);
  jowl.addColorStop(0, 'rgba(160,55,8,0)');
  jowl.addColorStop(1, 'rgba(140,48,6,0.44)');
  cx.fillStyle = jowl;
  cx.fillRect(CX - R - 1, CY + R * 0.3, R * 2 + 2, R * 0.7);

  // Eyebrows — angular, scowling
  cx.fillStyle = '#b86015';
  for (const sign of [-1, 1]) {
    const bx = CX + sign * R * 0.36;
    const by = CY - R * 0.40;
    cx.beginPath();
    cx.moveTo(bx - sign * R * 0.27, by - 0.5);  // outer top
    cx.lineTo(bx + sign * R * 0.10, by + 1.8);  // inner bottom (drooped)
    cx.lineTo(bx + sign * R * 0.10, by + 0.8);  // inner top
    cx.lineTo(bx - sign * R * 0.27, by + 0.6);  // outer bottom
    cx.closePath();
    cx.fill();
  }

  // Eyes — narrow squinting ovals
  const eyeY  = CY - R * 0.18;
  const eyeOX = R * 0.36;
  for (const sign of [-1, 1]) {
    const ex = CX + sign * eyeOX;
    cx.fillStyle = '#ddd8cc';
    cx.beginPath();
    cx.ellipse(ex, eyeY, R * 0.175, R * 0.082, 0, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = '#5577aa';
    cx.beginPath();
    cx.ellipse(ex, eyeY, R * 0.082, R * 0.078, 0, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = '#0a0a0a';
    cx.beginPath();
    cx.ellipse(ex, eyeY, R * 0.038, R * 0.038, 0, 0, Math.PI * 2);
    cx.fill();
  }

  // Nose
  cx.fillStyle = 'rgba(175,72,14,0.36)';
  cx.beginPath();
  cx.ellipse(CX, CY + R * 0.16, R * 0.15, R * 0.10, 0, 0, Math.PI * 2);
  cx.fill();

  // Mouth — pursed pout
  cx.strokeStyle = '#c03010';
  cx.lineWidth   = 1.0;
  cx.lineCap     = 'round';
  cx.beginPath();
  cx.moveTo(CX - R * 0.28, CY + R * 0.47);
  cx.quadraticCurveTo(CX, CY + R * 0.40, CX + R * 0.28, CY + R * 0.47);
  cx.stroke();
  cx.strokeStyle = '#d04020';
  cx.lineWidth   = 1.3;
  cx.beginPath();
  cx.moveTo(CX - R * 0.24, CY + R * 0.49);
  cx.quadraticCurveTo(CX, CY + R * 0.64, CX + R * 0.24, CY + R * 0.49);
  cx.stroke();

  cx.restore();  // end face clip

  // ── Neck (orange strip between face and collar) ───────────────────────────
  cx.fillStyle = '#e06820';
  cx.beginPath();
  cx.ellipse(CX, CY + R + 2, 4.5, 3.5, 0, 0, Math.PI * 2);
  cx.fill();

  if (foodSpriteCache.size >= MAX_SPRITE_CACHE) foodSpriteCache.delete(foodSpriteCache.keys().next().value);
  foodSpriteCache.set(key, off);
  return off;
}

// ─── Frame renderer ───────────────────────────────────────────────────────────

/**
 * Render one frame to `canvas`.
 * animRef holds inter-frame state for head interpolation:
 *   { prevCell:{x,y}, startMs:number, headIdx:number }
 */
function drawFrame(canvas, headIdxRef, snakeLenRef, foodRef, animRef) {
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
  const anim     = animRef.current;

  // ── Head interpolation ────────────────────────────────────────────────────
  // When headIdx changes a tick occurred. Interpolate the head from its
  // previous cell toward the current cell over ~140 ms for smooth movement.
  if (headIdx !== anim.headIdx) {
    // Old head is now body[1] after prepend; save it as the start of the glide.
    if (anim.headIdx >= 0 && snakeLen > 1) {
      const oldHead = segPool[(headIdx + 1) % POOL_SIZE];
      anim.prevCell = { x: oldHead.x, y: oldHead.y };
    } else {
      const cur = segPool[(headIdx) % POOL_SIZE];
      anim.prevCell = { x: cur.x, y: cur.y };
    }
    anim.startMs  = performance.now();
    anim.headIdx  = headIdx;
  }

  const head    = segPool[headIdx % POOL_SIZE];
  const elapsed = performance.now() - anim.startMs;
  const t       = Math.min(1, elapsed / 140);

  // Skip interpolation if the snake wrapped around the grid edge
  const dxRaw = head.x - anim.prevCell.x;
  const dyRaw = head.y - anim.prevCell.y;
  const skip  = Math.abs(dxRaw) > 1 || Math.abs(dyRaw) > 1;
  const hxF   = skip ? head.x : anim.prevCell.x + dxRaw * t;
  const hyF   = skip ? head.y : anim.prevCell.y + dyRaw * t;

  // ── Layer 2: food (Trump face) ────────────────────────────────────────────
  const fx = food.x * CELL + CELL / 2;
  const fy = food.y * CELL + CELL / 2;

  const foodGlow = buildGlowSprite('#ff8800', FOOD_RADIUS, FOOD_GLOW);
  if (foodGlow) {
    ctx.globalAlpha = 0.50;
    ctx.drawImage(foodGlow, fx - FOOD_TOTAL, fy - FOOD_TOTAL, FOOD_TOTAL * 2, FOOD_TOTAL * 2);
    ctx.globalAlpha = 1;
  }
  const foodSpr = buildTrumpSprite();
  if (foodSpr) {
    const S = CELL + FOOD_PAD * 2;
    ctx.drawImage(foodSpr, food.x * CELL - FOOD_PAD, food.y * CELL - FOOD_PAD, S, S);
  }

  // ── Layer 3: snake body (tail → neck, drawn back-to-front) ───────────────
  const bodySprite = buildCobraBodySprite();
  const BW = CELL + 4;  // body sprite logical size (oversized for overlap)
  for (let i = snakeLen - 1; i >= 1; i--) {
    const seg   = segPool[(headIdx + i) % POOL_SIZE];
    const alpha = Math.max(0.28, 1 - (i / snakeLen) * 0.72);
    ctx.globalAlpha = alpha;
    if (bodySprite) ctx.drawImage(bodySprite, seg.x * CELL - 2, seg.y * CELL - 2, BW, BW);
  }
  ctx.globalAlpha = 1;

  // ── Layer 4: head glow + rotated head sprite ──────────────────────────────
  const hcx = hxF * CELL + CELL / 2;
  const hcy = hyF * CELL + CELL / 2;

  // Amber glow halo
  const headGlow = buildGlowSprite('#ffaa00', HEAD_RADIUS, HEAD_GLOW);
  if (headGlow) {
    ctx.globalAlpha = 0.70;
    ctx.drawImage(headGlow, hcx - HEAD_TOTAL, hcy - HEAD_TOTAL, HEAD_TOTAL * 2, HEAD_TOTAL * 2);
    ctx.globalAlpha = 1;
  }

  // Derive movement direction from head → neck vector
  let dirX = 0, dirY = -1;   // default: face up on first frame
  if (snakeLen > 1) {
    const neck = segPool[(headIdx + 1) % POOL_SIZE];
    const rx   = head.x - neck.x;
    const ry   = head.y - neck.y;
    dirX = Math.abs(rx) > 1 ? -Math.sign(rx) : rx;  // un-wrap grid edge
    dirY = Math.abs(ry) > 1 ? -Math.sign(ry) : ry;
  }

  // Sprite is designed pointing UP (snout at y=0).
  // atan2(dy,dx): right=0, down=π/2, left=±π, up=-π/2.
  // Adding π/2 maps "right" → 90° CW, which rotates the up-sprite to point right. ✓
  const angle = Math.atan2(dirY, dirX) + Math.PI / 2;

  const headSprite = buildCobraHeadSprite();
  if (headSprite) {
    ctx.save();
    ctx.translate(hcx, hcy);
    ctx.rotate(angle);
    ctx.drawImage(headSprite, -CELL / 2, -CELL / 2, CELL, CELL);
    ctx.restore();
  }
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

  // Mutable interpolation state — lives outside React state to avoid re-renders.
  const animRef = useRef({ prevCell: { x: 0, y: 0 }, startMs: 0, headIdx: -1 });

  // rAF loop runs for the component's lifetime; all game data is read from refs.
  useEffect(() => {
    let rafId;
    const loop = () => {
      const canvas = canvasRef.current;
      if (canvas) drawFrame(canvas, headIdxRef, snakeLenRef, foodRef, animRef);
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
