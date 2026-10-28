/**
 * accessories.js — hats and tail decorations for the wardrobe.
 *
 * build() returns a fresh THREE.Group in world units (CELL = 20):
 *   hats   are parented to the head at its crown; local −Z is forward.
 *   tails  are placed at the tail tip; local +Z points away from the body.
 *
 * A hat may name a child 'halo-ring' to make it bob (hats are cloned for the
 * wrap-mode head copies, so they carry no object references in userData).
 *
 * Tail userData hooks read by the renderer each frame:
 *   shake    (rattle)  rattles about Y
 *   swing    (bell)    pivot swung about X
 *   flicker  (flame)   cones flicker in scale
 *   spin     (gems)    spins about Y
 *   boing    (cotton)  squash-and-stretch
 * Item flags: follower (drawn trailing behind the tail, hop = on the ground),
 * emitter (leaves a stardust trail).
 */
import * as THREE from 'three';
import { mkCanvas, rng } from './skins';

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 60, ...o });
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };

// ─── Hats (anchored on top of the head; local −Z is forward) ─────────────────
export const HATS = [
  { id: 'none', name: 'None', build: () => new THREE.Group() },
  { id: 'witch', name: 'Witch Hat', season: 'HALLOWEEN', build() {
    const g = new THREE.Group(), blk = phong(0x1c1428, { shininess: 20 });
    g.add(M(new THREE.CylinderGeometry(10.5, 10.5, 0.8, 32), blk));
    g.add(M(new THREE.CylinderGeometry(3.4, 5.6, 9, 24), blk, 0, 4.8, 0));
    g.add(M(new THREE.CylinderGeometry(5.7, 5.8, 1.8, 24), phong(0x8a3fe6), 0, 1.4, 0));
    g.add(M(new THREE.BoxGeometry(2.4, 2.2, 0.6), phong(0xf2c335, { shininess: 120 }), 0, 1.4, -5.8));
    const tip = new THREE.Group(); tip.position.set(0, 9.2, 0); tip.rotation.x = 0.7;
    tip.add(M(new THREE.ConeGeometry(3.4, 8, 20), blk, 0, 3.8, 0)); g.add(tip);
    g.rotation.x = 0.12; return g; } },
  { id: 'santa', name: 'Santa Hat', season: 'XMAS', build() {
    const g = new THREE.Group(), red = phong(0xd61f2a, { shininess: 15 }), wht = phong(0xffffff, { shininess: 5 });
    g.add(M(new THREE.CylinderGeometry(3.8, 6.2, 7, 24), red, 0, 4, 0));
    const t = new THREE.TorusGeometry(6.2, 1.9, 10, 28); const brim = M(t, wht, 0, 0.9, 0); brim.rotation.x = Math.PI / 2; g.add(brim);
    const pivot = new THREE.Group(); pivot.position.set(0, 7.4, 0); pivot.rotation.z = -1.05;
    pivot.add(M(new THREE.ConeGeometry(3.8, 9, 20), red, 0, 4.4, 0)); pivot.add(M(new THREE.SphereGeometry(2.4, 14, 10), wht, 0, 9, 0));
    g.add(pivot); return g; } },
  { id: 'tophat', name: 'Top Hat', build() {
    const g = new THREE.Group(), blk = phong(0x111114, { specular: 0x555555, shininess: 90 });
    g.add(M(new THREE.CylinderGeometry(9.5, 9.5, 0.8, 32), blk));
    g.add(M(new THREE.CylinderGeometry(5.8, 5.4, 11, 28), blk, 0, 5.9, 0));
    g.add(M(new THREE.CylinderGeometry(5.5, 5.5, 2.2, 28), phong(0xc8102e), 0, 1.6, 0));
    g.rotation.z = 0.12; return g; } },
  { id: 'crown', name: 'Crown', build() {
    const g = new THREE.Group(), gold = phong(0xf2c335, { specular: 0xfff0b0, shininess: 140, emissive: 0x2a1a00, side: THREE.DoubleSide });
    g.add(M(new THREE.CylinderGeometry(6.2, 5.6, 4.4, 28, 1, true), gold, 0, 2.2, 0));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      g.add(M(new THREE.ConeGeometry(1.5, 4.4, 8), gold, Math.cos(a) * 6, 6.5, Math.sin(a) * 6));
      g.add(M(new THREE.SphereGeometry(0.9, 8, 6), gold, Math.cos(a) * 6, 8.9, Math.sin(a) * 6));
      g.add(M(new THREE.SphereGeometry(1.1, 10, 8), phong(i % 2 ? 0x2a5cff : 0xe0143c, { shininess: 150, emissive: i % 2 ? 0x06103a : 0x3a0410 }), Math.cos(a + .52) * 6.1, 2.3, Math.sin(a + .52) * 6.1));
    }
    return g; } },
  { id: 'party', name: 'Party Cone', build() {
    const c = mkCanvas(64, 64), x = c.getContext('2d'); const cols = ['#ff3d7f', '#ffd23a', '#2bd6ff', '#7b5cff'];
    let tex = null;   // striped paper; plain pink where there is no 2D canvas
    if (x) {
      for (let i = 0; i < 8; i++) { x.fillStyle = cols[i % 4]; x.fillRect(0, i * 8, 64, 8); }
      x.fillStyle = '#fff'; for (let i = 0; i < 18; i++) { x.beginPath(); x.arc((i * 23) % 64, (i * 37) % 64, 2, 0, 7); x.fill(); }
      tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    }
    const g = new THREE.Group(); g.add(M(new THREE.ConeGeometry(4.8, 13, 24), phong(tex ? 0xffffff : 0xff3d7f, { map: tex }), 0, 6.5, 0));
    g.add(M(new THREE.SphereGeometry(2, 12, 10), phong(0xffd23a), 0, 13.2, 0)); g.rotation.z = 0.28; g.rotation.x = 0.1; return g; } },
  { id: 'viking', name: 'Viking Helm', build() {
    const g = new THREE.Group(), steel = phong(0x9aa2ab, { specular: 0xdddddd, shininess: 120 }), horn = phong(0xeee3c4, { shininess: 30 });
    const dome = M(new THREE.SphereGeometry(8, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, -3.4, 0); dome.scale.set(1.02, .9, 1.25); g.add(dome);
    const band = M(new THREE.TorusGeometry(8, 0.9, 8, 32), phong(0x8a6a2a, { shininess: 80 }), 0, -3.2, 0); band.rotation.x = Math.PI / 2; band.scale.set(1.02, 1.25, 1); g.add(band);
    g.add(M(new THREE.BoxGeometry(1.4, 8.6, 1.2), phong(0x8a6a2a), 0, 0.5, -1));
    for (const s of [-1, 1]) {
      const a = M(new THREE.ConeGeometry(2.3, 7.5, 14), horn, s * 9, 0.5, 0); a.rotation.z = -s * 1.15; g.add(a);
      const b = M(new THREE.ConeGeometry(1.4, 6, 12), horn, s * 12.2, 5.2, 0); b.rotation.z = -s * 0.2; g.add(b);
    }
    return g; } },
  { id: 'halo', name: 'Halo', bob: true, build() {
    const g = new THREE.Group(); const t = M(new THREE.TorusGeometry(6.2, 0.9, 10, 40), new THREE.MeshBasicMaterial({ color: 0xffe27a }), 0, 9, 1);
    t.rotation.x = Math.PI / 2 - 0.18; t.castShadow = false; t.name = 'halo-ring'; g.add(t); return g; } },
  { id: 'flowers', name: 'Flower Crown', season: 'SPRING', build() {
    const g = new THREE.Group(); const vine = M(new THREE.TorusGeometry(6.6, 0.6, 8, 32), phong(0x3f8f3a), 0, 0.6, 0); vine.rotation.x = Math.PI / 2; g.add(vine);
    const cols = [0xff8fc4, 0xffffff, 0xffd23a, 0xc99bff];
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; g.add(M(new THREE.SphereGeometry(1.8, 10, 8), phong(cols[i % 4], { shininess: 20 }), Math.cos(a) * 6.6, 1.2, Math.sin(a) * 6.6)); }
    return g; } },
  { id: 'bunny', name: 'Bunny Ears', season: 'EASTER', build() {
    const g = new THREE.Group(), fur = phong(0xfaf7f2, { shininess: 5 }), pink = phong(0xffa8c8, { shininess: 5 });
    g.add(M(new THREE.TorusGeometry(6.4, .8, 8, 28, Math.PI), phong(0xff7fb0), 0, -1, 0).rotateY(Math.PI / 2));   // headband
    for (const s of [-1, 1]) {
      const ear = new THREE.Group(); ear.position.set(s * 3.6, 0, 0); ear.rotation.z = -s * .22; ear.rotation.x = .12;
      const outer = M(new THREE.SphereGeometry(2.6, 16, 12), fur, 0, 8, 0); outer.scale.set(1, 3.4, .55); ear.add(outer);
      const inner = M(new THREE.SphereGeometry(1.6, 14, 10), pink, 0, 8, -1.1); inner.scale.set(1, 3.6, .3); ear.add(inner);
      if (s === 1) { ear.rotation.z = -.6; ear.children.forEach((c) => (c.position.y -= .5)); }   // one floppy ear
      g.add(ear);
    }
    return g; } },
  { id: 'shell', name: 'Eggshell Cap', season: 'EASTER', build() {
    const g = new THREE.Group(), m = phong(0xfff7e6, { shininess: 40, side: THREE.DoubleSide });
    const dome = M(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0, 0); dome.scale.set(1, 1.25, 1); g.add(dome);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, t = M(new THREE.ConeGeometry(1.3, 2.6, 4), m, Math.cos(a) * 6.6, -1, Math.sin(a) * 6.6); t.rotation.x = Math.PI; g.add(t); }
    const dots = [0xff7fb0, 0x3fcf96, 0x9a7bff];
    for (let i = 0; i < 7; i++) { const a = i * 2.4, e = .55 + (i % 3) * .3; g.add(M(new THREE.SphereGeometry(.9, 8, 6), phong(dots[i % 3]), Math.cos(a) * 7 * Math.cos(e), Math.sin(e) * 8.6, Math.sin(a) * 7 * Math.cos(e))); }
    g.position.y = 1; return g; } },
];

export const TAILS = [
  { id: 'none', name: 'None', build: () => new THREE.Group() },
  { id: 'rattle', name: 'Rattle', build() {
    const g = new THREE.Group(), m = phong(0xd8c08f, { shininess: 50 }), d = phong(0x8a6f45);
    [[3.6, 1.5], [3.1, 4.6], [2.6, 7.3], [2.0, 9.5]].forEach(([r, z]) => { const s = M(new THREE.SphereGeometry(r, 16, 12), m, 0, 0, z); s.scale.set(1, .8, .75); g.add(s); const ring = M(new THREE.TorusGeometry(r * .92, .35, 6, 18), d, 0, 0, z + r * .5); g.add(ring); });
    g.userData.shake = true; return g; } },
  { id: 'bow', name: 'Ribbon Bow', build() {
    const g = new THREE.Group(), red = phong(0xe0263b, { specular: 0xffaaaa, shininess: 80 });
    g.add(M(new THREE.SphereGeometry(1.8, 12, 10), red, 0, 3.4, 0));
    for (const s of [-1, 1]) {
      const loop = M(new THREE.ConeGeometry(2.8, 5.4, 14), red, s * 3, 3.6, 0); loop.rotation.z = s * Math.PI / 2; loop.scale.z = .5; g.add(loop);
      const tail = M(new THREE.BoxGeometry(1.6, .4, 6), red, s * 1.6, 2.4, 3.6); tail.rotation.y = s * .35; tail.rotation.x = .3; g.add(tail);
    }
    return g; } },
  { id: 'bell', name: 'Jingle Bell', season: 'XMAS', build() {
    const g = new THREE.Group(), gold = phong(0xf2c335, { specular: 0xffffff, shininess: 150, emissive: 0x2a1a00 });
    const pivot = new THREE.Group(); pivot.position.set(0, 3, 3); g.add(pivot);
    pivot.add(M(new THREE.SphereGeometry(3.6, 20, 14), gold, 0, -0.5, 2.6));
    const slot = M(new THREE.BoxGeometry(3.8, .6, .6), phong(0x2a1a00), 0, -1.8, 2.6); pivot.add(slot);
    const ribbon = M(new THREE.TorusGeometry(2.6, .7, 8, 20), phong(0x1f9a4a), 0, 0, 0); ribbon.rotation.y = Math.PI / 2; g.add(ribbon);
    g.userData.swing = pivot; return g; } },
  { id: 'flame', name: 'Comet Flame', build() {
    const g = new THREE.Group();
    const mk = (c, r, h, z) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = Math.PI / 2; m.position.z = z; return m; };
    const parts = [mk(0xff3d00, 3.6, 13, 6.5), mk(0xff9a00, 2.6, 10, 5.5), mk(0xfff0a0, 1.4, 6, 3.8)];
    parts.forEach((p) => g.add(p)); g.userData.flicker = parts;
    return g; } },
  { id: 'ghost', name: 'Ghost Buddy', season: 'HALLOWEEN', follower: true, build() {
    const g = new THREE.Group(), w = phong(0xf4f6ff, { transparent: true, opacity: .88, emissive: 0x30344a, shininess: 10 });
    g.add(M(new THREE.SphereGeometry(5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), w, 0, 0, 0));
    const skirt = M(new THREE.CylinderGeometry(5, 5.8, 6, 20, 1, true), w, 0, -3, 0); skirt.material = w.clone(); skirt.material.side = THREE.DoubleSide; g.add(skirt);
    const eye = phong(0x0a0a0a, { shininess: 100 });
    for (const s of [-1, 1]) { const e = M(new THREE.SphereGeometry(1, 10, 8), eye, s * 1.8, 1.4, -4.4); e.scale.set(.8, 1.3, .5); g.add(e); }
    const mouth = M(new THREE.SphereGeometry(.9, 10, 8), eye, 0, -1.2, -4.7); mouth.scale.set(1, 1.3, .4); g.add(mouth);
    return g; } },
  { id: 'sparkle', name: 'Stardust', emitter: true, build() {
    const g = new THREE.Group(); const gem = M(new THREE.OctahedronGeometry(2.4), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }), 0, 2.5, 3.5); gem.castShadow = false; g.add(gem); g.userData.spin = gem; return g; } },
  { id: 'cotton', name: 'Cotton Tail', season: 'EASTER', build() {
    const g = new THREE.Group(), fur = phong(0xffffff, { shininess: 2 }), r = rng(4);
    g.add(M(new THREE.SphereGeometry(4.2, 16, 12), fur, 0, 1.5, 3));
    for (let i = 0; i < 10; i++) g.add(M(new THREE.SphereGeometry(1.8 + r() * .8, 10, 8), fur, (r() - .5) * 6, 1.5 + (r() - .5) * 6, 3 + (r() - .5) * 6));
    g.userData.boing = true; return g; } },
  { id: 'chick', name: 'Chick Buddy', season: 'EASTER', follower: true, hop: true, build() {
    const g = new THREE.Group(), y = phong(0xffd83a, { shininess: 10 }), o = phong(0xff8a1a), k = phong(0x111111, { shininess: 100 });
    const b = M(new THREE.SphereGeometry(4.6, 18, 14), y, 0, 4.6, 0); b.scale.set(1, .95, 1.1); g.add(b);
    g.add(M(new THREE.SphereGeometry(3.2, 16, 12), y, 0, 9.6, -1.6));
    const beak = M(new THREE.ConeGeometry(1, 2.4, 8), o, 0, 9.4, -4.9); beak.rotation.x = -Math.PI / 2; g.add(beak);
    for (const s of [-1, 1]) {
      g.add(M(new THREE.SphereGeometry(.6, 8, 6), k, s * 1.4, 10.4, -4.3));
      const w = M(new THREE.SphereGeometry(2, 10, 8), y, s * 4.4, 5, .5); w.scale.set(.4, .9, 1.3); g.add(w);
      g.add(M(new THREE.BoxGeometry(1.2, .5, 2.2), o, s * 1.6, .25, -.6));
    }
    const shell = M(new THREE.SphereGeometry(5.2, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), phong(0xfff7e6, { side: THREE.DoubleSide }), 0, 3.4, 0); g.add(shell);
    return g; } },
];

