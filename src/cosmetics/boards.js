/**
 * boards.js — board looks for the wardrobe.
 *
 * 'level' keeps the per-level theme from levels.js (the original look). Any
 * other board overrides the theme's backdrop, ground, grid, light tint and
 * obstacle colour, and may add a weather layer (fx). Obstacles keep their
 * gameplay shape; only their colour changes, so the board never hides a wall.
 *
 * Canvas-only (no three.js) so the menu can draw thumbnails without WebGL.
 */
import { mkCanvas, rng } from './skins';

export const BOARDS = [
  { id: 'graveyard', name: 'Graveyard', group: 'Seasonal', season: 'HALLOWEEN', bg: 0x0d0a16, ground: 0x2c2439, speck: ['#3a3049', '#221b2d', '#463a58'], grid: 0x6a52a0, gridOp: 0.35,
    ambient: 0xb4b0e8, sun: 0xe2e8ff, obstacle: 0x77738a, fx: 'wisps' },
  { id: 'harvest', name: 'Harvest Field', group: 'Seasonal', season: 'AUTUMN', bg: 0x5a3a1a, ground: 0xa07a3a, speck: ['#b58a45', '#8a6430', '#c79a52'], grid: 0x6b4a20, gridOp: 0.3,
    ambient: 0xffe0b8, sun: 0xffc58a, obstacle: 0xe0bf5a, fx: 'leaves' },
  { id: 'snow', name: 'Snowfield', group: 'Seasonal', season: 'WINTER', bg: 0x9db7cc, ground: 0xeef4f8, speck: ['#ffffff', '#dfe9f1', '#e8f0f7'], grid: 0x9fb6c9, gridOp: 0.5,
    ambient: 0xdfefff, sun: 0xffffff, obstacle: 0x1f5a3a, fx: 'snow' },
  { id: 'blossom', name: 'Cherry Blossom', group: 'Seasonal', season: 'SPRING', bg: 0x6e9e63, ground: 0x9ad06e, speck: ['#a8da7c', '#86bf5c', '#ffc1dc'], grid: 0x6aa04e, gridOp: 0.35,
    ambient: 0xfff0f6, sun: 0xfff4f0, obstacle: 0x6a3f2a, fx: 'petals' },
  { id: 'egghunt', name: 'Egg Hunt', group: 'Seasonal', season: 'EASTER', bg: 0x9fd6c0, ground: 0xa8dc84, speck: ['#b6e696', '#94ca70', '#fff6a8'], grid: 0x7fb862, gridOp: 0.35,
    ambient: 0xfff4fa, sun: 0xfff8ec, obstacle: 0x9a7bff, fx: 'confetti' },
  { id: 'beach', name: 'Beach Day', group: 'Seasonal', season: 'SUMMER', bg: 0x1e8db3, ground: 0xe8cf94, speck: ['#f1dca7', '#d9bd7d', '#fff0c8'], grid: 0xc9a964, gridOp: 0.35,
    ambient: 0xfff8e8, sun: 0xfff2d0, obstacle: 0x8d8a84, fx: null },
  { id: 'level', name: 'Level Theme', group: 'Signature', tag: 'ORIGINAL' },
  { id: 'neon', name: 'Neon Grid', group: 'Signature', bg: 0x07030f, ground: 0x0c0718, speck: ['#120a24', '#0a0614', '#170c2c'], grid: 0xff2bd6, gridOp: 0.9,
    ambient: 0x8a6cff, sun: 0xff9be8, obstacle: 0x2a1050, obstacleGlow: 0x3a0a60, fx: 'rise' },
  { id: 'space', name: 'Deep Space', group: 'Signature', bg: 0x03040c, ground: 0x0f1330, speck: ['#ffffff', '#1a1f48', '#2a2f6a'], grid: 0x3c4fa8, gridOp: 0.45,
    ambient: 0x9daaff, sun: 0xd8dcff, obstacle: 0x5a3ab0, obstacleGlow: 0x1a0a40, fx: null },
];

/**
 * Weather layers. Positions are world units over the board; `spawn` gives a
 * particle's drift velocity, `sway` the side-to-side wobble, `rise` makes it
 * float up instead of falling, `add` draws it with additive blending.
 */
export const FX = {
  snow:     { n: 160, size: 3, cols: ['#ffffff'], area: 160, spawn: (r) => [0, -10 - r() * 10, 0], sway: 6 },
  petals:   { n: 90, size: 4, cols: ['#ffb6d5', '#ffd1e6', '#ffffff'], area: 160, spawn: (r) => [6, -9 - r() * 6, 3], sway: 14 },
  leaves:   { n: 70, size: 4.5, cols: ['#e0661c', '#f2b31a', '#a3321a'], area: 160, spawn: (r) => [5, -12 - r() * 6, 2], sway: 12 },
  confetti: { n: 90, size: 4, cols: ['#ffc9de', '#bff0d8', '#d9c8ff', '#fff1a8'], area: 160, spawn: (r) => [4, -8 - r() * 5, 2], sway: 12 },
  wisps:    { n: 60, size: 3.5, cols: ['#9b7bff', '#5affc8', '#ff8a2a'], area: 70, spawn: (r) => [(r() - 0.5) * 3, 3 + r() * 5, (r() - 0.5) * 3], sway: 6, add: true, rise: true },
  rise:     { n: 70, size: 3, cols: ['#22f0ff', '#ff2bd6'], area: 120, spawn: (r) => [0, 8 + r() * 14, 0], sway: 0, add: true, rise: true },
};

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Speckled ground canvas for a board (null without 2D canvas support). */
export function paintGround(b, size = 512) {
  const c = mkCanvas(size, size), x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = hex(b.ground); x.fillRect(0, 0, size, size);
  const r = rng(13), stars = b.id === 'space';
  for (let i = 0; i < 2600; i++) {
    const star = stars && i % 3 === 0;
    x.fillStyle = b.speck[i % b.speck.length];
    x.globalAlpha = star ? (r() < 0.1 ? 0.9 : 0.25) : 0.5;
    const s = star ? 1.5 : 2 + r() * 3;
    x.fillRect(r() * size, r() * size, s, s);
  }
  x.globalAlpha = 1;
  return c;
}

/** Small menu thumbnail: ground, grid and backdrop (null without 2D canvas support). */
export function paintBoardThumb(b, level) {
  const c = mkCanvas(150, 90), x = c.getContext('2d');
  if (!x) return null;
  const look = b.id === 'level' ? { bg: level.bg, ground: level.ground, grid: level.grid, gridOp: 0.25, speck: ['#ffffff'] } : b;
  x.fillStyle = hex(look.bg); x.fillRect(0, 0, 150, 90);
  x.fillStyle = hex(look.ground); x.fillRect(30, 6, 90, 78);
  x.strokeStyle = hex(look.grid); x.globalAlpha = Math.min(1, look.gridOp + 0.25); x.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    x.beginPath(); x.moveTo(30 + i * 15, 6); x.lineTo(30 + i * 15, 84); x.stroke();
    x.beginPath(); x.moveTo(30, 6 + i * 13); x.lineTo(120, 6 + i * 13); x.stroke();
  }
  x.globalAlpha = 1;
  if (b.obstacle) {
    x.fillStyle = hex(b.obstacle);
    for (const [cx, cy] of [[45, 19], [105, 19], [45, 58], [105, 58]]) x.fillRect(cx, cy, 13, 12);
  }
  return c;
}
