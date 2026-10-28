/**
 * skins.js — snake body skins for the wardrobe (pause menu → Customize).
 *
 * Each skin paints a TW×TH canvas that tiles along the body tube: canvas X
 * runs along the body LENGTH (one tile per `ulen` cells, default 2) and
 * canvas Y wraps the circumference. CanvasTexture flips Y, so the top of the
 * tube (v = 0.25) is canvas y = 0.75·TH; use vy(v) to place things.
 *
 *   draw(ctx)  albedo (required)
 *   glow(ctx)  emissive mask painted on black (optional)
 *   head       head colour / specular / shininess (no texture except Coral)
 *   eye        iris colour, emissive glow, optional black socket
 *
 * Canvas-only (no three.js) so the menu can draw swatches without WebGL.
 */

export const TW = 256, TH = 128;

export const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
export const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const vy = (v) => (1 - v) * TH;       // CanvasTexture flips Y: v=0.25 (top of tube) is canvas y=0.75H

// ─── Texture helpers ──────────────────────────────────────────────────────────
function scales(ctx, a = 0.3, hl = 0.14, step = 16) {
  for (let row = 0; row < TH / step + 1; row++) for (let col = 0; col < TW / step + 1; col++) {
    const cx = col * step + (row % 2 ? step / 2 : 0), cy = row * step;
    ctx.beginPath(); ctx.moveTo(cx, cy - step / 2); ctx.lineTo(cx + step / 2, cy); ctx.lineTo(cx, cy + step / 2); ctx.lineTo(cx - step / 2, cy); ctx.closePath();
    ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.lineWidth = 1.4; ctx.stroke();
    if (hl) { ctx.beginPath(); ctx.moveTo(cx - step * .32, cy - step * .16); ctx.lineTo(cx, cy - step * .42); ctx.strokeStyle = `rgba(255,255,255,${hl})`; ctx.lineWidth = 1; ctx.stroke(); }
  }
}
// Draw something in all nine tile positions so it tiles seamlessly across both texture edges.
function wrapDraw(ctx, fn) { for (const dx of [-TW, 0, TW]) for (const dy of [-TH, 0, TH]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); } }
function bands(ctx, list) { for (const [x0, x1, c] of list) { ctx.fillStyle = c; ctx.fillRect(Math.round(x0 * TW), 0, Math.ceil((x1 - x0) * TW), TH); } }
function star(ctx, x, y, r1, r2, n, rot = 0) { ctx.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + i * Math.PI / n; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }

// ─── Skins ────────────────────────────────────────────────────────────────────
export const SKINS = [
  // Halloween
  { id: 'bone', name: 'Bone Rattler', group: 'Halloween', season: 'HALLOWEEN',
    head: { color: 0xefeadf, spec: 0x777777, shin: 40 }, eye: { color: 0xff2a1a, glow: 0xcc1100, socket: 0x0a0a0a },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, TH); g.addColorStop(0, '#d9d3c4'); g.addColorStop(.75, '#f4f0e6'); g.addColorStop(1, '#ddd6c6');
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH);
      ctx.strokeStyle = '#0d0d0f'; ctx.lineCap = 'round'; ctx.lineWidth = 7;
      wrapDraw(ctx, () => {
        for (let k = 0; k < 4; k++) {
          const x0 = (k + .5) * TW / 4;
          for (const dir of [1, -1]) {     // a rib curls down each flank from the spine
            ctx.beginPath();
            for (let s = 0; s <= 0.36; s += 0.02) { const v = .25 + dir * s; ctx.lineTo(x0 + Math.pow(s, 1.25) * 70, vy(v)); }
            ctx.stroke();
          }
        }
        ctx.fillStyle = '#0d0d0f';
        for (let x = 0; x < TW; x += TW / 8) { ctx.beginPath(); ctx.ellipse(x + 16, vy(.25), 7, 5, 0, 0, Math.PI * 2); ctx.fill(); }
      });
      scales(ctx, .08, .1);
    } },
  { id: 'spider', name: 'Spider Silk', group: 'Halloween', season: 'HALLOWEEN', ulen: 2.5,
    head: { color: 0x121214, spec: 0x999999, shin: 110 }, eye: { color: 0xe8f0ff, glow: 0x4a5a80 },
    draw(ctx) {
      ctx.fillStyle = '#131316'; ctx.fillRect(0, 0, TW, TH);
      scales(ctx, .5, .06);
      const web = (cx, cy, R) => {
        ctx.strokeStyle = 'rgba(240,240,250,.85)'; ctx.lineWidth = 1.6;
        const sp = 9;
        for (let i = 0; i < sp; i++) { const a = i / sp * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke(); }
        for (let r = R * .22; r <= R; r += R * .2) {
          ctx.beginPath();
          for (let i = 0; i <= sp; i++) {
            const a = i / sp * Math.PI * 2, a0 = (i - .5) / sp * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.quadraticCurveTo(cx + Math.cos(a0) * r * .8, cy + Math.sin(a0) * r * .8, x, y);
          }
          ctx.stroke();
        }
      };
      wrapDraw(ctx, () => { web(TW * .3, vy(.25), 58); web(TW * .8, vy(.75), 52); });
      ctx.fillStyle = '#d4141e';   // black-widow hourglass on the back
      wrapDraw(ctx, () => { const x = TW * .8, y = vy(.25); ctx.beginPath(); ctx.moveTo(x - 7, y - 9); ctx.lineTo(x + 7, y - 9); ctx.lineTo(x, y); ctx.lineTo(x + 7, y + 9); ctx.lineTo(x - 7, y + 9); ctx.lineTo(x, y); ctx.closePath(); ctx.fill(); });
    } },
  { id: 'jack', name: "Jack-o'-Lantern", group: 'Halloween', season: 'HALLOWEEN',
    head: { color: 0xe8700f, spec: 0x553300, shin: 30 }, eye: { color: 0xffd23a, glow: 0xffb000 }, glowPulse: true,
    draw(ctx) {
      ctx.fillStyle = '#e46c0e'; ctx.fillRect(0, 0, TW, TH);
      for (let i = 0; i < 8; i++) { const y = i * TH / 8; const g = ctx.createLinearGradient(0, y, 0, y + TH / 8); g.addColorStop(0, 'rgba(120,40,0,.45)'); g.addColorStop(.5, 'rgba(255,160,60,.12)'); g.addColorStop(1, 'rgba(120,40,0,.45)'); ctx.fillStyle = g; ctx.fillRect(0, y, TW, TH / 8); }
      this.carve(ctx, '#ffcf40');
    },
    glow(ctx) { this.carve(ctx, '#ffb31a'); },
    carve(ctx, col) {
      ctx.fillStyle = col;
      wrapDraw(ctx, () => {
        for (let k = 0; k < 2; k++) {
          const x0 = k * TW / 2, y = vy(.25);
          star(ctx, x0 + 26, y - 14, 9, 9, 1.5, -Math.PI / 2); ctx.fill();        // carved triangle eyes
          star(ctx, x0 + 26, y + 14, 9, 9, 1.5, -Math.PI / 2); ctx.fill();
          ctx.beginPath();                                                          // jagged grin along the flank
          for (let i = 0; i <= 8; i++) ctx.lineTo(x0 + 48 + i * 9, y + (i % 2 ? -14 : -4));
          for (let i = 8; i >= 0; i--) ctx.lineTo(x0 + 48 + i * 9, y + (i % 2 ? 4 : 14));
          ctx.closePath(); ctx.fill();
        }
      });
    } },
  // Seasonal
  { id: 'frost', name: 'Frostbite', group: 'Seasonal', season: 'WINTER',
    head: { color: 0xdff3ff, spec: 0xffffff, shin: 140 }, eye: { color: 0x5fe6ff, glow: 0x1aa8d8 },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, TH); g.addColorStop(0, '#8fcff2'); g.addColorStop(.75, '#e8f7ff'); g.addColorStop(1, '#a8dcf7');
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH);
      scales(ctx, .12, .35);
      const r = rng(7); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.6;
      for (let i = 0; i < 14; i++) {
        const x = r() * TW, y = r() * TH, s = 4 + r() * 5;
        wrapDraw(ctx, () => { for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s); ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); ctx.stroke(); } });
      }
    } },
  { id: 'candy', name: 'Candy Cane', group: 'Seasonal', season: 'XMAS', ulen: 1.5,
    head: { color: 0xf7f2f0, spec: 0xffffff, shin: 120 }, eye: { color: 0x2bd06b, glow: 0x0a5a22 },
    draw(ctx) {
      ctx.fillStyle = '#f8f4f2'; ctx.fillRect(0, 0, TW, TH);
      const P = TW / 4;     // stripe period; a full turn shifts by one period so it tiles
      for (let i = -3; i < 6; i++) {
        const x0 = i * P;
        ctx.fillStyle = '#d4182c'; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + P * .45, 0); ctx.lineTo(x0 + P * 1.45, TH); ctx.lineTo(x0 + P, TH); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#1f9a4a'; ctx.beginPath(); ctx.moveTo(x0 + P * .62, 0); ctx.lineTo(x0 + P * .7, 0); ctx.lineTo(x0 + P * 1.7, TH); ctx.lineTo(x0 + P * 1.62, TH); ctx.closePath(); ctx.fill();
      }
    } },
  { id: 'bloom', name: 'Spring Bloom', group: 'Seasonal', season: 'SPRING',
    head: { color: 0x6cc06a, spec: 0x444444, shin: 50 }, eye: { color: 0xffb02e, glow: 0x3a2000 },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, TH); g.addColorStop(0, '#5fae55'); g.addColorStop(.75, '#8fd27a'); g.addColorStop(1, '#5fae55');
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH); scales(ctx, .18, .12);
      const r = rng(11), cols = ['#ff8fc4', '#ffffff', '#ffd1ea', '#c99bff'];
      for (let i = 0; i < 14; i++) {
        const x = r() * TW, y = r() * TH, c = cols[i % cols.length], rot = r() * 6;
        wrapDraw(ctx, () => {
          ctx.fillStyle = c;
          for (let p = 0; p < 5; p++) { const a = rot + p * Math.PI * 2 / 5; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.4, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
        });
      }
    } },
  { id: 'egg', name: 'Easter Egg', group: 'Seasonal', season: 'EASTER',
    head: { color: 0xffc9de, spec: 0xffffff, shin: 90 }, eye: { color: 0x7a5cff, glow: 0x1a0a40 },
    draw(ctx) {
      bands(ctx, [[0, .25, '#ffc9de'], [.25, .5, '#bff0d8'], [.5, .75, '#d9c8ff'], [.75, 1, '#fff1a8']]);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
      for (let k = 0; k < 4; k++) {               // zigzag ribbon down the middle of each band
        const x0 = (k + .5) * TW / 4; ctx.beginPath();
        for (let y = -8; y <= TH + 8; y += 8) ctx.lineTo(x0 + ((y / 8) % 2 ? 7 : -7), y); ctx.stroke();
        ctx.fillStyle = ['#ff7fb0', '#3fcf96', '#9a7bff', '#f2c12e'][k];
        for (let y = 4; y < TH; y += 16) { ctx.beginPath(); ctx.arc(x0 - 18, y, 2.6, 0, 7); ctx.arc(x0 + 18, y + 8, 2.6, 0, 7); ctx.fill(); }
      }
      scales(ctx, .06, .2);
    } },
  { id: 'choco', name: 'Choco Bunny', group: 'Seasonal', season: 'EASTER',
    head: { color: 0x5a2f1a, spec: 0xc89a7a, shin: 120 }, eye: { color: 0xf2c335, glow: 0x3a2600 },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, TH); g.addColorStop(0, '#3e1f10'); g.addColorStop(.75, '#7a4326'); g.addColorStop(1, '#3e1f10');
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH); scales(ctx, .3, .18, 20);
      const f = ctx.createLinearGradient(0, 0, 0, TH); f.addColorStop(0, '#a87a22'); f.addColorStop(.7, '#ffe596'); f.addColorStop(1, '#a87a22');
      ctx.fillStyle = f; ctx.fillRect(TW * .78, 0, TW * .16, TH);          // gold foil wrapper band
      ctx.strokeStyle = 'rgba(120,80,10,.5)'; ctx.lineWidth = 1;
      for (let y = 0; y < TH; y += 6) { ctx.beginPath(); ctx.moveTo(TW * .78, y); ctx.lineTo(TW * .94, y + 3); ctx.stroke(); }
      ctx.fillStyle = '#d4182c'; ctx.fillRect(TW * .84, 0, TW * .04, TH);
    } },
  { id: 'melon', name: 'Watermelon', group: 'Seasonal', season: 'SUMMER',
    head: { color: 0x2f8a3a, spec: 0x777777, shin: 70 }, eye: { color: 0x1a1a1a, glow: 0x000000 },
    draw(ctx) {
      bands(ctx, [[0, .52, '#9fd46b'], [.52, .58, '#effad8'], [.58, 1, '#ff4f62']]);
      ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 8;
      for (let k = 0; k < 6; k++) { ctx.beginPath(); for (let x = 0; x <= TW * .52; x += 4) ctx.lineTo(x, k * TH / 6 + 8 + Math.sin(x * .12 + k) * 4); ctx.stroke(); }
      const r = rng(3); ctx.fillStyle = '#1a1210';
      for (let i = 0; i < 14; i++) { const x = TW * (.62 + r() * .34), y = r() * TH; ctx.beginPath(); ctx.ellipse(x, y, 3.6, 2, 0, 0, Math.PI * 2); ctx.fill(); }
    } },
  { id: 'autumn', name: 'Maple Rustle', group: 'Seasonal', season: 'AUTUMN',
    head: { color: 0x8a3b12, spec: 0x553311, shin: 40 }, eye: { color: 0xf2c12e, glow: 0x402800 },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, TW, 0); g.addColorStop(0, '#b8461a'); g.addColorStop(.5, '#d98a1f'); g.addColorStop(1, '#b8461a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH); scales(ctx, .2, .1);
      const r = rng(5), cols = ['#7e2410', '#f2b31a', '#a3321a', '#5a3a12'];
      for (let i = 0; i < 12; i++) {
        const x = r() * TW, y = r() * TH, s = 7 + r() * 4, rot = r() * 6, c = cols[i % 4];
        wrapDraw(ctx, () => { ctx.fillStyle = c; star(ctx, x, y, s, s * .45, 5, rot); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(rot + 2) * s * 1.2, y + Math.sin(rot + 2) * s * 1.2); ctx.stroke(); });
      }
    } },
  // Signature
  { id: 'coral', name: 'Coral', group: 'Signature', tag: 'ORIGINAL', builtin: true,   // the game keeps its own coral textures
    head: { color: 0x141414, spec: 0x999999, shin: 110 }, eye: { color: 0xf2d21a, glow: 0x352600 },
    draw(ctx) { bands(ctx, [[0, .11, '#f4c518'], [.11, .47, '#b01818'], [.47, .58, '#f4c518'], [.58, 1, '#141414']]); scales(ctx, .35, .16); } },
  { id: 'neon', name: 'Neon Viper', group: 'Signature',
    head: { color: 0x0a0612, spec: 0xff7be8, shin: 120 }, eye: { color: 0xff2bd6, glow: 0xff2bd6 }, glowPulse: true,
    draw(ctx) { ctx.fillStyle = '#0a0614'; ctx.fillRect(0, 0, TW, TH); scales(ctx, 0, 0); ctx.globalAlpha = .25; this.lines(ctx); ctx.globalAlpha = 1; },
    glow(ctx) { this.lines(ctx); },
    lines(ctx) {
      ctx.lineWidth = 3; ctx.strokeStyle = '#ff2bd6';
      for (const v of [.08, .42]) { ctx.beginPath(); ctx.moveTo(0, vy(v)); ctx.lineTo(TW, vy(v)); ctx.stroke(); }
      ctx.strokeStyle = '#22f0ff';
      for (let x = 0; x < TW; x += 32) { ctx.beginPath(); ctx.moveTo(x + 4, vy(.25) - 10); ctx.lineTo(x + 16, vy(.25)); ctx.lineTo(x + 4, vy(.25) + 10); ctx.stroke(); }
    } },
  { id: 'lava', name: 'Molten Core', group: 'Signature',
    head: { color: 0x1d0f0a, spec: 0x553322, shin: 30 }, eye: { color: 0xff7a00, glow: 0xff5a00 }, glowPulse: true,
    draw(ctx) { ctx.fillStyle = '#1c0f0b'; ctx.fillRect(0, 0, TW, TH); scales(ctx, .4, .05, 20); this.cracks(ctx, '#ff5a00'); },
    glow(ctx) { this.cracks(ctx, '#ff8a1a'); },
    cracks(ctx, col) {
      const r = rng(21); ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineJoin = 'round';
      for (let i = 0; i < 16; i++) {
        let x = r() * TW, y = r() * TH; const pts = [[x, y]];
        for (let k = 0; k < 7; k++) { x += 6 + r() * 12; y += (r() - .5) * 22; pts.push([x, y]); }
        wrapDraw(ctx, () => { ctx.beginPath(); pts.forEach(([a, b]) => ctx.lineTo(a, b)); ctx.stroke(); });
      }
    } },
  { id: 'galaxy', name: 'Galaxy', group: 'Signature',
    head: { color: 0x150a30, spec: 0xb48cff, shin: 100 }, eye: { color: 0xc6a8ff, glow: 0x8a5cff },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, TH); g.addColorStop(0, '#12082e'); g.addColorStop(.75, '#2c0f58'); g.addColorStop(1, '#12082e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH); this.sky(ctx, 1);
    },
    glow(ctx) { this.sky(ctx, .55); },
    sky(ctx, a) {
      const r = rng(9);
      for (let i = 0; i < 7; i++) {
        const x = r() * TW, y = r() * TH, rad = 18 + r() * 26, c = i % 2 ? `rgba(255,70,190,${.35 * a})` : `rgba(60,200,255,${.3 * a})`;
        wrapDraw(ctx, () => { const gr = ctx.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); });
      }
      for (let i = 0; i < 90; i++) { const s = r() < .12 ? 2 : 1; ctx.fillStyle = `rgba(255,255,255,${(.5 + r() * .5) * Math.min(1, a * 1.6)})`; ctx.fillRect(r() * TW, r() * TH, s, s); }
    } },
  { id: 'gold', name: '24K', group: 'Signature',
    head: { color: 0xd8a83a, spec: 0xfff0c0, shin: 160 }, eye: { color: 0xd11a4a, glow: 0x400010 },
    draw(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, TH); g.addColorStop(0, '#7a5410'); g.addColorStop(.5, '#c9982f'); g.addColorStop(.75, '#ffe596'); g.addColorStop(1, '#a87a22');
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH); scales(ctx, .35, .35);
    } },
  { id: 'prism', name: 'Prism', group: 'Signature', scroll: 0.35,
    head: { color: 0xffffff, spec: 0xffffff, shin: 120 }, eye: { color: 0x111111, glow: 0x000000 },
    draw(ctx) { for (let x = 0; x < TW; x++) { ctx.fillStyle = `hsl(${x / TW * 360},85%,58%)`; ctx.fillRect(x, 0, 1, TH); } scales(ctx, .25, .2); } },
];


/** Paint `skin` onto fresh canvases; returns { map, glow } (glow may be null), or null without 2D canvas support. */
export function paintSkin(skin) {
  const map = mkCanvas(TW, TH), ctx = map.getContext('2d');
  if (!ctx) return null;
  skin.draw(ctx);
  let glow = null;
  if (skin.glow) {
    glow = mkCanvas(TW, TH);
    const g = glow.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, TW, TH);
    skin.glow(g);
  }
  return { map, glow };
}
