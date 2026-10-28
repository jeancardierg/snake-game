/**
 * obstacles.js — board-themed obstacle models (tombstones on Graveyard,
 * snowmen on Snowfield, …) with a small idle animation each.
 *
 * Values come from Snake Obstacle Lab (the prototype). Rules that keep a
 * themed obstacle readable as a wall on every board and camera view:
 *   - it never leaves its cell: idle motion is sway, flicker or bob only, so
 *     gameplay and collisions are unchanged;
 *   - it sits on a footprint tile that fills its cell and never rotates (only
 *     the model turns), in the board's `plate` colour with an `edge` rim; this
 *     carries the contrast where the model alone would not (white snowmen on
 *     snow, sandcastles on sand, only roofs visible in Top-down);
 *   - it stays within OBSTACLE_H (constants.js), which cameraViews.js fits into frame.
 * The 'level' board (and any board without a set) keeps the plain blocks.
 *
 * createObstacleLayer() → { group, active, setBoard(id), setCells(cells), update(now, animate), dispose() }
 * cells: [{ x, z, key }] — world position of each cell's centre and a stable
 * integer per cell (picks the model variant and its turn).
 */
import * as THREE from 'three';
import { CELL } from '../constants';

export const OBSTACLE_SETS = {
  graveyard: { kinds: ['tomb', 'cross'],     plate: 0x120e1a, edge: 0x9b7bff, glow: true },
  harvest:   { kinds: ['hay', 'pumpkin'],    plate: 0x4a2e10, edge: 0x2a1806 },
  snow:      { kinds: ['pine', 'snowman'],   plate: 0x4f6a82, edge: 0x22384c },
  blossom:   { kinds: ['sakura', 'toro'],    plate: 0x3d5e2c, edge: 0x6a3f2a },
  egghunt:   { kinds: ['egg', 'basket'],     plate: 0x4d7a3a, edge: 0x5b3fc4 },
  beach:     { kinds: ['castle', 'rocks'],   plate: 0x8a6c38, edge: 0x4a3a1c },
  neon:      { kinds: ['pylon', 'pyramid'],  plate: 0x1a0a30, edge: 0x22f0ff, glow: true, square: true },
  space:     { kinds: ['asteroid', 'crystal'], plate: 0x1c2150, edge: 0x7a8cff, glow: true },
};

// ─── Kit ──────────────────────────────────────────────────────────────────────
const M = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: o.flat ?? true,
  emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: o.op != null, opacity: o.op ?? 1,
  side: o.side ?? THREE.FrontSide });
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = shadow;
  return m;
}
const G = () => new THREE.Group();
const sph = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (a, b, h, s = 12) => new THREE.CylinderGeometry(a, b, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);

// Each builder takes a variant seed and returns { g, tick(t, ph) }: t in seconds, ph a per-cell phase.
const MODELS = {
  tomb() {
    const g = G(), stone = M(0x9a95ae), engr = M(0x4a465a);
    g.add(mesh(box(16, 2, 12), M(0x3b2f2a), 0, 1, 0));
    const slab = G(); slab.position.y = 2; g.add(slab);
    slab.add(mesh(box(12, 9, 4), stone, 0, 4.5, 0));
    const arch = mesh(cyl(6, 6, 4, 14), stone, 0, 9, 0); arch.rotation.x = Math.PI / 2; slab.add(arch);
    slab.add(mesh(box(6, 1, 0.6), engr, 0, 9, 2.1, false), mesh(box(4, 1, 0.6), engr, 0, 6.5, 2.1, false));
    g.add(mesh(cyl(1, 1, 3.5, 8), M(0xf3ecd8), 5, 3.75, 5));
    const flame = mesh(cone(0.9, 2.4, 6), M(0xffb43a, { e: 0xff8a1a, ei: 2 }), 5, 6.7, 5, false); g.add(flame);
    return { g, tick(t, ph) {
      slab.rotation.z = 0.05 * Math.sin(t * 0.7 + ph);
      flame.scale.y = 1 + 0.35 * Math.sin(t * 13 + ph * 3) + 0.15 * Math.sin(t * 31 + ph);
      flame.material.emissiveIntensity = 1.6 + 0.6 * Math.sin(t * 17 + ph);
    } };
  },
  cross() {
    const g = G(), stone = M(0x8c879e);
    g.add(mesh(box(14, 2, 14), M(0x3b2f2a), 0, 1, 0));
    g.add(mesh(box(4, 16, 4), stone, 0, 10, 0), mesh(box(12, 3.5, 4), stone, 0, 13, 0));
    const wisp = mesh(sph(1.6, 8, 6), M(0x5affc8, { e: 0x5affc8, ei: 2.4 }), 0, 10, 8, false); g.add(wisp);
    return { g, tick(t, ph) { const a = t * 1.6 + ph; wisp.position.set(Math.cos(a) * 8, 10 + 2 * Math.sin(t * 2.3 + ph), Math.sin(a) * 8); } };
  },
  hay() {
    const g = G();
    g.add(mesh(box(15, 10, 11), M(0xe2c35e), 0, 5, 0));
    const strap = M(0x9a7428);
    for (const z of [-3, 3]) g.add(mesh(box(15.4, 10.4, 1.2), strap, 0, 5, z));
    const straw = M(0xf1d77c);
    const tufts = [[-4, -2], [1, 3], [5, -1]].map(([x, z]) => { const tf = mesh(cone(1.2, 5, 5), straw, x, 12, z); g.add(tf); return tf; });
    return { g, tick(t, ph) { tufts.forEach((tf, i) => { tf.rotation.z = 0.35 * Math.sin(t * 3 + ph + i * 1.7); tf.rotation.x = 0.2 * Math.cos(t * 2.4 + i); }); } };
  },
  pumpkin() {
    const g = G(), p = G(); p.position.y = 6; g.add(p);
    p.add(mesh(sph(8, 12, 8), M(0xe0661c)));
    const stem = mesh(cyl(1, 1.4, 4, 6), M(0x4f6a1e), 0, 12, 0); g.add(stem);
    const leaf = mesh(sph(2.4, 6, 4), M(0x6f9a2a), 2.4, 11.4, 0); leaf.scale.set(1, 0.3, 0.6); g.add(leaf);
    return { g, tick(t, ph) {
      const b = 0.72 + 0.035 * Math.sin(t * 2 + ph), w = 1 + (0.72 - b) * 0.6;
      p.scale.set(w, b, w);
      stem.rotation.z = 0.25 * Math.sin(t * 2.6 + ph);
    } };
  },
  pine() {
    const g = G(), tree = G(); g.add(tree);
    tree.add(mesh(cyl(1.5, 2, 4, 6), M(0x5a3a22), 0, 2, 0));
    const green = M(0x1f5a3a), snow = M(0xffffff);
    for (const [r, h, y] of [[8.5, 8, 7.5], [6.8, 7.5, 12], [4.8, 6.5, 16]]) {
      tree.add(mesh(cone(r, h, 8), green, 0, y, 0));
      tree.add(mesh(cone(r * 0.55, h * 0.35, 8), snow, 0, y + h * 0.33, 0));
    }
    return { g, tick(t, ph) { tree.rotation.z = 0.04 * Math.sin(t * 1.2 + ph); tree.rotation.x = 0.03 * Math.cos(t * 0.9 + ph); } };
  },
  snowman() {
    const g = G(), s = G(); s.scale.setScalar(0.72); g.add(s);
    const white = M(0xf7fbff, { flat: false }), coal = M(0x1a1a1f, { flat: false }), wood = M(0x5a3a22);
    s.add(mesh(sph(6.2, 14, 10), white, 0, 6, 0), mesh(sph(4.6, 14, 10), white, 0, 14, 0));
    const head = G(); head.position.y = 21; s.add(head);
    head.add(mesh(sph(3.4, 14, 10), white));
    const nose = mesh(cone(0.8, 4, 6), M(0xf07a1e), 0, 0, 4.4); nose.rotation.x = Math.PI / 2; head.add(nose);
    for (const x of [-1.3, 1.3]) head.add(mesh(sph(0.5, 6, 4), coal, x, 1, 3.1, false));
    head.add(mesh(cyl(3.6, 3.6, 0.6, 12), coal, 0, 2.8, 0), mesh(cyl(2.4, 2.4, 3.6, 12), coal, 0, 4.8, 0));
    s.add(mesh(cyl(4.4, 5.4, 1.2, 12), M(0xd6332a), 0, 17.6, 0));
    for (const y of [12, 15]) s.add(mesh(sph(0.55, 6, 4), coal, 0, y, 4.4, false));
    const arm = (side) => {
      const a = G(); a.position.set(side * 4.2, 15, 0);
      const st = mesh(cyl(0.45, 0.45, 8, 5), wood, side * 4, 0, 0); st.rotation.z = Math.PI / 2; a.add(st);
      s.add(a); return a;
    };
    arm(-1).rotation.z = -0.4;
    const armR = arm(1);
    return { g, tick(t, ph) { armR.rotation.z = 0.5 + 0.45 * Math.sin(t * 5 + ph); head.rotation.z = 0.08 * Math.sin(t * 2.5 + ph); } };
  },
  sakura() {
    const g = G(), bark = M(0x6a3f2a), crown = G();
    g.add(mesh(cyl(1.4, 2.2, 10, 6), bark, 0, 5, 0));
    const br = mesh(cyl(0.8, 1.1, 6, 5), bark, 2.5, 9, 0); br.rotation.z = -0.7; g.add(br);
    crown.position.y = 12; g.add(crown);
    for (const [x, y, z, r, c] of [[0, 2, 0, 6, 0xffb6d5], [-4.5, 0, 1, 4.6, 0xff9cc6], [4.5, 0.5, -1, 4.8, 0xffc8de], [0.5, -0.5, 4.2, 4.2, 0xff9cc6], [0, 0, -4.4, 4.4, 0xffb6d5]]) {
      crown.add(mesh(new THREE.IcosahedronGeometry(r, 0), M(c), x, y, z));
    }
    return { g, tick(t, ph) {
      crown.rotation.z = 0.06 * Math.sin(t * 1.4 + ph);
      crown.rotation.y = 0.15 * Math.sin(t * 0.6 + ph);
      crown.position.x = 0.6 * Math.sin(t * 1.4 + ph);
    } };
  },
  toro() {
    const g = G(), stone = M(0xa5a39b);
    g.add(mesh(box(11, 2, 11), stone, 0, 1, 0), mesh(cyl(1.8, 2.2, 6, 8), stone, 0, 5, 0), mesh(box(9, 1.4, 9), stone, 0, 8.7, 0));
    const light = M(0xffe2a6, { e: 0xffb24a, ei: 1.5 });
    g.add(mesh(box(5.4, 4.4, 5.4), light, 0, 11.6, 0));
    for (const [x, z] of [[-2.9, -2.9], [2.9, -2.9], [-2.9, 2.9], [2.9, 2.9]]) g.add(mesh(box(1.4, 4.6, 1.4), stone, x, 11.6, z));
    const roof = mesh(cone(9, 4.5, 4), M(0x7f7d77), 0, 16, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
    g.add(mesh(sph(1.3, 8, 6), stone, 0, 19, 0));
    return { g, tick(t, ph) { light.emissiveIntensity = 1.1 + 0.5 * Math.sin(t * 2.2 + ph) + 0.15 * Math.sin(t * 9 + ph); } };
  },
  egg(seed) {
    const g = G(), e = G(); g.add(e);
    const sets = [[0x8f6cff, 0xffe066, 0xff7eb6], [0x2fc4a0, 0xff7eb6, 0xfff6d6], [0xff8a3d, 0x6fd3ff, 0xfff6d6]];
    const [base, band, dots] = sets[seed % 3];
    const shell = mesh(sph(6.5, 18, 14), M(base, { flat: false }), 0, 8.4, 0); shell.scale.set(1, 1.32, 1); e.add(shell);
    // painted bands as thin rings hugging the shell
    for (const [y, r] of [[10.6, 6.15], [6.6, 6.25]]) {
      const ring = mesh(new THREE.TorusGeometry(r, 0.9, 6, 24), M(band, { flat: false }), 0, y, 0, false); ring.rotation.x = Math.PI / 2; e.add(ring);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      e.add(mesh(sph(0.9, 6, 4), M(dots, { flat: false }), Math.cos(a) * 6.4, 8.6, Math.sin(a) * 6.4, false));
    }
    return { g, tick(t, ph) {
      e.rotation.z = 0.16 * Math.sin(t * 2.2 + ph) * Math.max(0, Math.sin(t * 0.7 + ph));
      e.rotation.x = 0.08 * Math.cos(t * 1.7 + ph);
    } };
  },
  basket() {
    const g = G(), weave = M(0x8a5a2a);
    g.add(mesh(cyl(8, 6.2, 7, 10), M(0xa8743c), 0, 3.5, 0));
    const lip = mesh(new THREE.TorusGeometry(8, 0.7, 6, 20), weave, 0, 7, 0); lip.rotation.x = Math.PI / 2; g.add(lip);
    g.add(mesh(cyl(7.4, 7.4, 0.6, 10), M(0x7fcf5a), 0, 6.8, 0));
    for (const [c, x, z] of [[0xff7eb6, -3, -1], [0xffe066, 2.5, -2.5], [0x8f6cff, 1, 3]]) {
      const e = mesh(sph(2.4, 10, 8), M(c, { flat: false }), x, 8.2, z); e.scale.set(1, 1.3, 1); g.add(e);
    }
    const handle = G(); handle.position.y = 7; g.add(handle);
    handle.add(mesh(new THREE.TorusGeometry(7, 0.7, 6, 20, Math.PI), weave));
    return { g, tick(t, ph) { handle.rotation.y = 0.25 * Math.sin(t * 1.5 + ph); handle.rotation.x = 0.2 * Math.sin(t * 1.1 + ph); } };
  },
  castle() {
    const g = G(), sand = M(0xd2b16e), dark = M(0xb8955a);
    g.add(mesh(box(12, 5, 12), sand, 0, 2.5, 0));
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
      g.add(mesh(cyl(2.3, 2.6, 9, 8), sand, x, 4.5, z), mesh(cyl(2.7, 2.3, 1.4, 8), dark, x, 9.6, z));
    }
    g.add(mesh(cyl(3.8, 4.2, 13, 8), sand, 0, 6.5, 0), mesh(cone(4.4, 4, 8), dark, 0, 15, 0));
    g.add(mesh(cyl(0.3, 0.3, 4, 4), M(0x5a3a22), 0, 18, 0));
    const flag = G(); flag.position.set(0, 18.5, 0); g.add(flag);
    const cloth = mesh(new THREE.PlaneGeometry(5, 3, 4, 1), M(0xe8402a, { side: THREE.DoubleSide }), 2.5, 0, 0); flag.add(cloth);
    const pos = cloth.geometry.attributes.position, base = pos.array.slice();
    return { g, tick(t, ph) {
      for (let i = 0; i < pos.count; i++) { const x0 = base[i * 3]; pos.array[i * 3 + 2] = Math.sin(t * 6 + ph + x0 * 1.2) * 0.5 * (x0 + 2.5) / 5; }
      pos.needsUpdate = true;
      flag.rotation.y = 0.3 * Math.sin(t * 0.8 + ph);
    } };
  },
  rocks() {
    const g = G();
    for (const [x, y, z, r, c] of [[0, 5, 0, 7, 0x8d8a84], [-4, 3, 3.5, 4, 0x76736d], [4, 2.6, 3.5, 3.5, 0x9a978f]]) {
      const m = mesh(new THREE.DodecahedronGeometry(r, 0), M(c), x, y, z); m.rotation.set(x, z, y); g.add(m);
    }
    const gull = G(); gull.position.set(0, 12, 0); g.add(gull);
    const white = M(0xffffff, { flat: false });
    const body = mesh(sph(2, 10, 8), white); body.scale.set(0.9, 0.9, 1.6); gull.add(body);
    gull.add(mesh(sph(1.3, 8, 6), white, 0, 1.4, 2.6));
    const beak = mesh(cone(0.45, 1.6, 5), M(0xf2b31a), 0, 1.2, 4.2); beak.rotation.x = Math.PI / 2; gull.add(beak);
    const wingMat = M(0xb9bec6);
    const wings = [-1, 1].map((s) => { const w = mesh(box(4, 0.4, 2.2), wingMat, s * 2.6, 0.6, 0); gull.add(w); return w; });
    return { g, tick(t, ph) {
      gull.position.y = 12 + 0.4 * Math.sin(t * 3 + ph);
      gull.rotation.y = 0.6 * Math.sin(t * 0.5 + ph);
      const flap = Math.sin(t * 1.1 + ph) > 0.85 ? Math.sin(t * 20) * 0.6 : 0;
      wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * flap; });
    } };
  },
  pylon() {
    const g = G(), core = M(0x2a1050, { e: 0x3a0a60 });
    g.add(mesh(box(13, 14, 13), core, 0, 7, 0));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x22f0ff });
    const ed = new THREE.LineSegments(new THREE.EdgesGeometry(box(13.2, 14.2, 13.2)), edgeMat); ed.position.y = 7; g.add(ed);
    g.add(mesh(box(13.4, 1.2, 13.4), M(0x22f0ff, { e: 0x22f0ff, ei: 1.4 }), 0, 7, 0, false));
    const ring = mesh(new THREE.TorusGeometry(4.5, 0.6, 6, 24), M(0xff2bd6, { e: 0xff2bd6, ei: 2 }), 0, 17, 0, false); ring.rotation.x = Math.PI / 2; g.add(ring);
    const cA = new THREE.Color(0x22f0ff), cB = new THREE.Color(0xbffcff);
    return { g, tick(t, ph) {
      const k = 0.5 + 0.5 * Math.sin(t * 3 + ph);
      edgeMat.color.copy(cA).lerp(cB, k);
      core.emissiveIntensity = 0.6 + 0.8 * k;
      ring.rotation.z = t * 2 + ph; ring.rotation.y = 0.4 * Math.sin(t + ph);
    } };
  },
  pyramid() {
    const g = G(), core = M(0x2a1050, { e: 0x5a0a50 });
    const p = mesh(cone(10, 16, 4), core, 0, 8, 0); p.rotation.y = Math.PI / 4; g.add(p);
    const ed = new THREE.LineSegments(new THREE.EdgesGeometry(cone(10.2, 16.3, 4)), new THREE.LineBasicMaterial({ color: 0xff2bd6 }));
    ed.position.y = 8; ed.rotation.y = Math.PI / 4; g.add(ed);
    const orb = mesh(sph(1.6, 10, 8), M(0xffffff, { e: 0x22f0ff, ei: 2.5, flat: false }), 0, 17.5, 0, false); g.add(orb);
    return { g, tick(t, ph) { orb.position.y = 17.5 + 1.2 * Math.sin(t * 2.4 + ph); core.emissiveIntensity = 0.7 + 0.6 * Math.max(0, Math.sin(t * 4 + ph)); } };
  },
  asteroid(seed) {
    const g = G(), geo = new THREE.IcosahedronGeometry(7.5, 1), pa = geo.attributes.position;
    // Lumpy rock: push shared vertices in or out by the same seeded amount so faces stay closed.
    let s = 1 + seed * 7919;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const seen = new Map();
    for (let i = 0; i < pa.count; i++) {
      const key = `${pa.getX(i).toFixed(3)},${pa.getY(i).toFixed(3)},${pa.getZ(i).toFixed(3)}`;
      if (!seen.has(key)) seen.set(key, 0.78 + r() * 0.34);
      const k = seen.get(key);
      pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k, pa.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const rock = mesh(geo, M(0x7466a6, { e: 0x1a0a40 }), 0, 10, 0); rock.scale.set(1, 0.85, 1); g.add(rock);
    const crater = M(0x4a3f78);
    for (const [x, z, cr] of [[3, 4, 1.6], [-4, 1, 1.2], [1, -5, 1.4]]) {
      const c = mesh(new THREE.CircleGeometry(cr, 8), crater, x, 5.6, z, false); c.rotation.x = -Math.PI / 2; rock.add(c);
    }
    return { g, tick(t, ph) {
      rock.rotation.y = t * 0.4 + ph;
      rock.rotation.x = 0.3 * Math.sin(t * 0.5 + ph);
      rock.position.y = 10 + 1.4 * Math.sin(t * 1.3 + ph);
    } };
  },
  crystal() {
    const g = G(), glass = M(0x8fe8ff, { e: 0x3aa8ff });
    g.add(mesh(new THREE.DodecahedronGeometry(6, 0), M(0x3a3f6a), 0, 2, 0));
    for (const [x, y, z, r, sy, rz] of [[0, 10.5, 0, 3.2, 3, 0], [-4, 8, 2, 2.2, 2.4, 0.4], [3.5, 8, -2.5, 2.4, 2.4, -0.45], [2, 7, 4, 1.8, 2.2, -0.3]]) {
      const c = mesh(new THREE.OctahedronGeometry(r, 0), glass, x, y, z); c.scale.y = sy; c.rotation.z = rz; g.add(c);
    }
    return { g, tick(t, ph) { glass.emissiveIntensity = 0.6 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2 + ph)); } };
  },
};

const TURNS = [0, 0.5, -0.4, 0.25];

/** Cell-sized footprint: an `edge` rim around a `plate` tile, flush with the ground. */
function footprint(edgeMat, plateMat) {
  const g = G();
  const edge = mesh(box(CELL * 0.96, 0.7, CELL * 0.96), edgeMat, 0, 0.35, 0, false);
  const fill = mesh(box(CELL * 0.8, 0.9, CELL * 0.8), plateMat, 0, 0.45, 0, false);
  edge.receiveShadow = fill.receiveShadow = true;
  g.add(edge, fill);
  return g;
}

function disposeTree(o) {
  o.traverse((m) => { m.geometry?.dispose(); for (const x of [m.material].flat()) x?.dispose(); });
}

export function createObstacleLayer() {
  const group = new THREE.Group();
  let boardId = null, cells = [], items = [];

  function rebuild() {
    for (const c of [...group.children]) { group.remove(c); disposeTree(c); }
    items = [];
    const set = OBSTACLE_SETS[boardId];
    if (!set) return;
    const edgeMat = M(set.edge, { e: set.glow ? set.edge : 0x000000, ei: 0.55 });
    const plateMat = M(set.plate);
    for (const { x, z, key } of cells) {
      const holder = G();
      holder.position.set(x, 0, z);
      // Hash the cell so mirrored level layouts still mix both kinds and turns.
      const h = Math.imul(key + 1, 2654435761) >>> 0;
      const model = MODELS[set.kinds[(h >>> 16) % set.kinds.length]](key);
      model.g.rotation.y = set.square ? 0 : TURNS[(h >>> 8) % TURNS.length];   // turn the model, never its footprint
      holder.add(model.g, footprint(edgeMat, plateMat));
      group.add(holder);
      items.push({ tick: model.tick, ph: key * 1.37 });
    }
  }

  return {
    group,
    /** True when the board has a themed set (the plain blocks should hide). */
    get active() { return !!OBSTACLE_SETS[boardId]; },
    setBoard(id) { if (id !== boardId) { boardId = id; rebuild(); } },
    setCells(next) { cells = next; rebuild(); },
    /** Idle animation; with animate false the models hold their rest pose. */
    update(nowMs, animate = true) {
      const t = animate ? nowMs / 1000 : 0;
      for (const it of items) it.tick(t, animate ? it.ph : 0);
    },
    dispose() { for (const c of [...group.children]) { group.remove(c); disposeTree(c); } items = []; },
  };
}
