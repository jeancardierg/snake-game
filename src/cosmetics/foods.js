/**
 * foods.js — what the snake eats, picked in the Customize menu.
 *
 * build() returns a fresh THREE.Group in world units (CELL = 20), centred on
 * the item; the renderer places it `y` units above the ground and spins it
 * about Y (`spin` radians per frame). A child named 'pulse' gets a blinking
 * emissive (the mine's detonator, the lantern's face, the gem's glow).
 * `burst` colours the eat flash and particles; `glow` the ground marker.
 *
 * 'mine' is the original look: the game keeps drawing its own (level-tinted)
 * mine for it, and uses this build only for the menu thumbnail and preview.
 *
 * Every food sits on a pulsing ground marker (foodMarker) with a bright glow
 * ring and a dark outline ring, so it stands out on dark and light boards.
 */
import * as THREE from 'three';
import { mkCanvas } from './skins';

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 60, ...o });
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };

export const MINE_R = 7;   // CELL * 0.35, as in GameCanvas

export const FOODS = [
  // ── Signature ──────────────────────────────────────────────────────────────
  { id: 'mine', name: 'Classic Mine', group: 'Signature', tag: 'ORIGINAL', builtin: true, y: MINE_R * 0.8, burst: 0xff4400, glow: 0xff5a3c, build() {
    const g = new THREE.Group(), steel = phong(0x1a1a1a, { specular: 0x666666, shininess: 90, emissive: 0x0a0a0a });
    g.add(M(new THREE.SphereGeometry(MINE_R, 18, 14), steel));
    const spikeGeo = new THREE.ConeGeometry(1.8, 5, 6), spikeMat = phong(0x2a2a2a, { specular: 0x888888 });
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [0, -0.7, 0.7]]) {
      const s = M(spikeGeo, spikeMat, x * MINE_R, y * MINE_R, z * MINE_R);
      s.lookAt(s.position.clone().multiplyScalar(2)); g.add(s);
    }
    const det = M(new THREE.SphereGeometry(1.5, 8, 6), phong(0xff0000, { emissive: 0x400000, shininess: 100 }), 0, MINE_R + 1.5, 0);
    det.name = 'pulse'; g.add(det);
    return g; } },
  { id: 'apple', name: 'Red Apple', group: 'Signature', y: 6.4, burst: 0xff3030, glow: 0xff6a5a, build() {
    const g = new THREE.Group();
    const body = M(new THREE.SphereGeometry(6.4, 22, 16), phong(0xd8202a, { specular: 0xffcccc, shininess: 110, emissive: 0x2a0000 })); body.scale.set(1, 0.9, 1); g.add(body);
    g.add(M(new THREE.CylinderGeometry(0.5, 0.7, 3.6, 6), phong(0x5a3a1a), 0, 6.6, 0));
    const leaf = M(new THREE.SphereGeometry(2, 10, 6), phong(0x3fae3a), 1.9, 7, 0); leaf.scale.set(1.1, 0.3, 0.55); leaf.rotation.z = 0.5; g.add(leaf);
    return g; } },
  { id: 'donut', name: 'Sprinkle Donut', group: 'Signature', y: 4.5, burst: 0xff7ab8, glow: 0xff8ac8, build() {
    const g = new THREE.Group(), tilt = new THREE.Group(); tilt.rotation.x = -0.55; g.add(tilt);
    const dough = M(new THREE.TorusGeometry(4.6, 2.6, 14, 28), phong(0xd9a35f, { shininess: 20 })); dough.rotation.x = Math.PI / 2; tilt.add(dough);
    const icing = M(new THREE.TorusGeometry(4.6, 2.65, 14, 28), phong(0xff7ab8, { shininess: 90 }), 0, 0.9, 0); icing.rotation.x = Math.PI / 2; icing.scale.z = 0.6; tilt.add(icing);
    const cols = [0xffffff, 0xffd23a, 0x2bd6ff, 0x7b5cff, 0x5ce17a], sg = new THREE.BoxGeometry(1.1, 0.35, 0.35);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + (i % 3) * 0.2, r = 4.6 + ((i * 7) % 5 - 2) * 0.45;
      const s = M(sg, phong(cols[i % cols.length]), Math.cos(a) * r, 2.5, Math.sin(a) * r); s.rotation.y = i * 1.3; tilt.add(s);
    }
    return g; } },
  { id: 'gem', name: 'Crystal Gem', group: 'Signature', y: 8, burst: 0x2bd6ff, glow: 0x2bd6ff, build() {
    const g = new THREE.Group();
    const gem = M(new THREE.OctahedronGeometry(6), phong(0x39e0ff, { emissive: 0x0a5a70, specular: 0xffffff, shininess: 150, flatShading: true, transparent: true, opacity: 0.92 }));
    gem.scale.set(1, 1.35, 1); gem.name = 'pulse'; g.add(gem);
    return g; } },
  { id: 'coin', name: 'Gold Coin', group: 'Signature', y: 7.5, spin: 0.05, burst: 0xffd23a, glow: 0xffd23a, build() {
    const g = new THREE.Group(), gold = phong(0xf2c335, { specular: 0xfff0b0, shininess: 140, emissive: 0x3a2600 });
    const coin = M(new THREE.CylinderGeometry(6.2, 6.2, 1.6, 32), gold); coin.rotation.x = Math.PI / 2; g.add(coin);
    for (const z of [-0.9, 0.9]) {
      const face = M(new THREE.CylinderGeometry(4.4, 4.4, 0.4, 5), phong(0xffdc5a, { shininess: 160, emissive: 0x4a3200 }), 0, 0, z);
      face.rotation.x = Math.PI / 2; g.add(face);
    }
    return g; } },

  // ── Seasonal ───────────────────────────────────────────────────────────────
  { id: 'pumpkin', name: 'Jack-o\'-Lantern', group: 'Seasonal', season: 'HALLOWEEN', y: 5.6, burst: 0xff8a1a, glow: 0xffa030, build() {
    const g = new THREE.Group(), orange = phong(0xf07a12, { shininess: 40, emissive: 0x2a1000 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, lobe = M(new THREE.SphereGeometry(4.2, 14, 10), orange, Math.cos(a) * 3, 0, Math.sin(a) * 3);
      lobe.scale.set(0.75, 1.15, 0.75); g.add(lobe);
    }
    g.add(M(new THREE.CylinderGeometry(0.7, 1, 3, 6), phong(0x4a7a2a), 0, 5.6, 0));
    const face = new THREE.Group(), fire = new THREE.MeshPhongMaterial({ color: 0xffd23a, emissive: 0xff9a10, emissiveIntensity: 1 });
    for (const s of [-1, 1]) { const eye = M(new THREE.ConeGeometry(1.2, 1.8, 3), fire, s * 2, 1.4, 6); eye.rotation.x = Math.PI / 2; face.add(eye); }
    const mouth = M(new THREE.BoxGeometry(4.6, 1, 0.8), fire, 0, -1.6, 6); face.add(mouth);
    face.children.forEach((m) => { m.name = 'pulse'; });
    g.add(face);
    return g; } },
  { id: 'candy', name: 'Wrapped Candy', group: 'Seasonal', season: 'HALLOWEEN', y: 5, burst: 0xb46bff, glow: 0xc58aff, build() {
    const g = new THREE.Group(), wrap = phong(0x8a3fe6, { shininess: 120, emissive: 0x1a0830 });
    const body = M(new THREE.SphereGeometry(3.6, 18, 12), wrap); body.scale.set(1.45, 1, 1); g.add(body);
    for (const s of [-1, 1]) { const end = M(new THREE.ConeGeometry(3, 3.6, 12), wrap, s * 6.4, 0, 0); end.rotation.z = s * Math.PI / 2; g.add(end); }
    for (const s of [-1, 0, 1]) { const band = M(new THREE.TorusGeometry(3.2, 0.35, 6, 20), phong(0xffd23a), s * 1.9, 0, 0); band.rotation.y = Math.PI / 2; band.scale.set(1, 1.02 - Math.abs(s) * 0.12, 1); g.add(band); }
    return g; } },
  { id: 'gift', name: 'Gift Box', group: 'Seasonal', season: 'XMAS', y: 4.6, burst: 0xffd23a, glow: 0xff5a5a, build() {
    const g = new THREE.Group(), gold = phong(0xf2c335, { shininess: 120 });
    g.add(M(new THREE.BoxGeometry(8.4, 8, 8.4), phong(0xd61f2a, { shininess: 30, emissive: 0x200000 })));
    g.add(M(new THREE.BoxGeometry(8.6, 8.2, 1.6), gold));
    g.add(M(new THREE.BoxGeometry(1.6, 8.2, 8.6), gold));
    for (const s of [-1, 1]) { const loop = M(new THREE.TorusGeometry(1.7, 0.55, 8, 16), gold, s * 1.7, 5.2, 0); loop.rotation.y = Math.PI / 2; loop.rotation.x = s * 0.5; g.add(loop); }
    return g; } },
  { id: 'egg', name: 'Easter Egg', group: 'Seasonal', season: 'EASTER', y: 7, burst: 0xff9ad5, glow: 0xff9ad5, build() {
    const c = mkCanvas(128, 64), x = c.getContext('2d');
    let tex = null;   // painted bands; plain pastel where there is no 2D canvas
    if (x) {
      const bands = ['#ffb3d9', '#b8e3ff', '#fff1a8', '#c9f2c0', '#d9c2ff', '#ffb3d9'];
      bands.forEach((b, i) => { x.fillStyle = b; x.fillRect(0, i * 64 / 6, 128, 64 / 6 + 1); });
      x.strokeStyle = '#ffffff'; x.lineWidth = 2.5;
      for (const yy of [16, 37]) { x.beginPath(); for (let i = 0; i <= 16; i++) x.lineTo(i * 8, yy + (i % 2 ? -3.5 : 3.5)); x.stroke(); }
      tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    }
    const g = new THREE.Group(), egg = M(new THREE.SphereGeometry(5.2, 24, 18), phong(tex ? 0xffffff : 0xffb3d9, { map: tex, shininess: 70 }));
    egg.scale.set(1, 1.3, 1); g.add(egg);
    return g; } },
  { id: 'carrot', name: 'Carrot', group: 'Seasonal', season: 'EASTER', y: 4, burst: 0xff8a1a, glow: 0xffa040, build() {
    const g = new THREE.Group();
    const root = M(new THREE.ConeGeometry(2.8, 11, 14), phong(0xff7a1a, { shininess: 30, emissive: 0x2a0e00 }), -1, 0, 0); root.rotation.z = Math.PI / 2; g.add(root);
    const leaf = phong(0x3fae3a);
    for (const [a, l] of [[-0.5, 5], [0, 6], [0.5, 5]]) { const f = M(new THREE.ConeGeometry(0.8, l, 6), leaf, 5.6, 0, 0); f.rotation.z = -Math.PI / 2 + a; f.position.x += l / 2 * Math.cos(a) - 0.5; f.position.y = l / 2 * Math.sin(a); g.add(f); }
    return g; } },
  { id: 'watermelon', name: 'Watermelon Slice', group: 'Seasonal', season: 'SUMMER', y: 4, burst: 0xff4d6d, glow: 0x7ae07a, build() {
    const g = new THREE.Group(), red = phong(0xff3d5a, { shininess: 50, emissive: 0x200008 });
    const slice = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 3, 28, 1, false, Math.PI / 2, Math.PI), [phong(0x2f9a3a, { shininess: 80 }), red, red]);
    slice.rotation.x = Math.PI / 2; slice.position.y = -3.5; slice.castShadow = true; g.add(slice);
    const seed = phong(0x1a1a1a, { shininess: 100 }), sg = new THREE.SphereGeometry(0.5, 6, 4);
    for (const [sx, sy] of [[-3.5, 1.2], [-1.2, 2.6], [1.2, 2.6], [3.5, 1.2], [0, 0.9]]) for (const z of [-1.55, 1.55]) {
      const s = M(sg, seed, sx, sy - 3.5 + 1, z); s.scale.set(0.7, 1.2, 0.4); g.add(s);
    }
    return g; } },
  { id: 'acorn', name: 'Acorn', group: 'Seasonal', season: 'AUTUMN', y: 6, burst: 0xc8862a, glow: 0xffb050, build() {
    const g = new THREE.Group();
    const nut = M(new THREE.SphereGeometry(4.6, 18, 14), phong(0xb5702a, { shininess: 90, emissive: 0x1a0a00 }), 0, -1.2, 0); nut.scale.set(1, 1.25, 1); g.add(nut);
    const cap = M(new THREE.SphereGeometry(5.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), phong(0x6a4420, { shininess: 10 }), 0, 1.2, 0); cap.scale.y = 0.65; g.add(cap);
    g.add(M(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 6), phong(0x5a3a1a), 0, 5, 0));
    return g; } },
];

/**
 * Pulsing ground marker drawn under the food: a dark outline ring and a bright
 * additive glow ring, so the food reads on any board, dark or light.
 * Returns { group, setColor(hex), update(seconds) }.
 */
export function foodMarker() {
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  const dark = new THREE.Mesh(new THREE.RingGeometry(9.4, 11, 40), darkMat);
  const glow = new THREE.Mesh(new THREE.RingGeometry(7.4, 9.4, 40), glowMat);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(7.4, 32), fillMat);
  for (const m of [dark, glow, fill]) { m.renderOrder = 1; group.add(m); }
  return {
    group,
    setColor(hex) { glowMat.color.set(hex); fillMat.color.set(hex); },
    update(t) {
      const p = (Math.sin(t * 4) + 1) / 2;
      group.scale.setScalar(0.94 + p * 0.1);
      glowMat.opacity = 0.55 + p * 0.4;
    },
  };
}
