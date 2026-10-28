/**
 * GameCanvas — WebGL renderer using three.js.
 *
 * Draws the snake game board in full 3D with:
 *   - Snake body: one continuous, tapered tube that follows a fixed path on
 *     the ground (the visited cells with rounded corners, see snakePath.js),
 *     sampled by distance behind a constant-speed head, with a lateral
 *     "slither" wave pinned to the ground (amplitude ramps from 0 at the head
 *     so the head stays grid-accurate) and glossy procedural scale texture
 *   - Sleek wedge head oriented along the body, with eyes + a flicking tongue
 *   - Mine food: dark metallic sphere with spike protrusions and blinking
 *     red detonator
 *   - Grass-green ground plane + grid lines
 *   - Directional sun + ambient + fill lights, PCF shadow map
 *   - Point-light flash on eat, particle burst, camera shake on death
 *   - Wrap mode: pulsing portal glow on the board edges, and a snake that slides
 *     through one edge and out of the opposite one (see "Wrap rendering" below)
 *   - Cosmetics from the pause menu (see cosmetics/): body skin, hat on the
 *     head, tail decoration, and a board look that can replace the level theme
 *
 * All game state is read from refs every frame (no React reconciliation per tick).
 * The three.js scene is created once on mount and torn down on unmount.
 *
 * Rendering-only module: game logic (useSnake.js) is untouched. The path and
 * slither are a visual layer over the existing grid path — the head always
 * resolves to its exact cell so food/eat alignment is preserved.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { COLS, ROWS, CELL, MAX_OBSTACLES } from '../constants';
import { getLevel } from '../levels';
import { segPool, POOL_SIZE } from '../pool';
import { computeCanvasSize, MAX_PIXEL_RATIO } from '../canvasSize';
import { shadowHalfExtent } from '../shadowFit';
import { BODY_R, HEAD_R, HEAD_Y, HEAD_SCALE, NECK_EXIT, neckProfile } from '../snakeProfile';
import { filletRadii, samplePath, slitherOffset, SLITHER_AMP } from '../snakePath';
import { paintSkin } from '../cosmetics/skins';
import { FX, paintGround } from '../cosmetics/boards';
import { DEFAULT_LOADOUT, findItem } from '../cosmetics/loadout';

const SIZE = COLS * CELL;   // world units (260 on 13×13)
const HALF = SIZE / 2;      // 100

// Grid cell (col,row) → world X / Z (Y is height). Scalar variants avoid the
// per-call Vector3 allocation of cellToWorld inside the hot centerline loop.
function worldX(col) { return col * CELL - HALF + CELL / 2; }
function worldZ(row) { return row * CELL - HALF + CELL / 2; }

// Map grid cell (col, row) to world XZ position (Y=height)
function cellToWorld(col, row, height = 0) {
  return new THREE.Vector3(worldX(col), height, worldZ(row));
}

// ─── Wrap rendering ───────────────────────────────────────────────────────────
// In wrap mode the snake is laid out along an "unwrapped" path: every segment is
// placed next to its predecessor, even when that runs off the board. The tube is
// built once along that continuous path, then drawn again shifted by whole board
// widths for every board-sized tile the path touches. The orthographic camera
// frustum is exactly the board, so the off-board part of each copy is cut away
// for free — no clipping planes, and the body-building code is unchanged.

// Shortest signed grid delta on a ring of size n: a step across an edge reads
// as ±1 instead of ∓(n-1).
function wrapDelta(d, n) { return d - n * Math.round(d / n); }

// Tiles are identified by integer (kx, kz): tile (0,0) is the board itself.
const TILE_BIAS   = 512;   // keeps packed keys non-negative (|k| ≤ POOL_SIZE)
const tileKey     = (kx, kz) => (kx + TILE_BIAS) * 1024 + (kz + TILE_BIAS);
const ORIGIN_TILE = tileKey(0, 0);

/**
 * Add the tile under world point (x, z) to `set`, plus any neighbour tile
 * within `margin` world units — geometry around the point spills that far.
 */
function addTiles(set, x, z, margin) {
  const kx = Math.floor((x + HALF) / SIZE);
  const kz = Math.floor((z + HALF) / SIZE);
  const fx = x + HALF - kx * SIZE;
  const fz = z + HALF - kz * SIZE;
  const x0 = fx < margin ? kx - 1 : kx, x1 = fx > SIZE - margin ? kx + 1 : kx;
  const z0 = fz < margin ? kz - 1 : kz, z1 = fz > SIZE - margin ? kz + 1 : kz;
  for (let a = x0; a <= x1; a++) {
    for (let b = z0; b <= z1; b++) set.add(tileKey(a, b));
  }
}

// Soft glow strip for the portal edges: opaque at the wall, fading inward.
// CanvasTexture flips Y, so canvas row 0 lands at v = 1 (the plane's +Y side).
function makePortalTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}

// ─── Procedural snake textures ────────────────────────────────────────────────

// Coral-snake scale skin. The U axis (0..1) runs along the body LENGTH, so each
// vertical stripe is one solid band ring; a single tile holds one full cycle
// (yellow collar → red → yellow → black) and repeats down the body via ULEN.
// The V axis wraps the circumference. Diamond scales tile as a neutral overlay.
function makeSnakeBodyTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');

  // Bands along the length (canvas X = U). Cycle starts on yellow so the neck
  // reads as a yellow collar right behind the black head. "Red touches yellow."
  const YELLOW = '#f4c518';
  const RED     = '#b01818';
  const BLACK   = '#141414';
  const bands = [
    [0.00, 0.11, YELLOW],   // thin yellow (collar)
    [0.11, 0.47, RED],      // wide red
    [0.47, 0.58, YELLOW],   // thin yellow
    [0.58, 1.00, BLACK],    // wide black
  ];
  for (const [x0, x1, col] of bands) {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x0 * 128), 0, Math.ceil((x1 - x0) * 128), 128);
  }

  // Diamond scale lattice
  const step = 16;
  for (let row = 0; row < 128 / step + 1; row++) {
    for (let col = 0; col < 128 / step + 1; col++) {
      const cx = col * step + (row % 2 ? step / 2 : 0);
      const cy = row * step;
      ctx.beginPath();
      ctx.moveTo(cx, cy - step * 0.5);
      ctx.lineTo(cx + step * 0.5, cy);
      ctx.lineTo(cx, cy + step * 0.5);
      ctx.lineTo(cx - step * 0.5, cy);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // top-left glossy highlight on each scale
      ctx.beginPath();
      ctx.moveTo(cx - step * 0.32, cy - step * 0.16);
      ctx.lineTo(cx, cy - step * 0.42);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Glossy black head skin (coral-snake style): dark with a central gloss and a
// subtle angular "brow" highlight — no color cast.
function makeSnakeHeadTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0.0, '#0a0a0a');
  g.addColorStop(0.5, '#262626');   // central gloss highlight
  g.addColorStop(1.0, '#0a0a0a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);

  // Faint brow chevron pointing forward (gloss only, keeps the sculpted look)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(14, 40);
  ctx.lineTo(32, 16);
  ctx.lineTo(50, 40);
  ctx.stroke();

  // Fine dark scale flecks
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect((i * 17) % 64, (i * 29) % 64, 2, 2);
  }
  return new THREE.CanvasTexture(c);
}

// ─── Component ────────────────────────────────────────────────────────────────
export function GameCanvas({ headIdxRef, snakeLenRef, foodRef, obstaclesRef, levelIndex, stateRef, wrap = false, loadout = DEFAULT_LOADOUT }) {
  const canvasRef = useRef(null);
  const color     = getLevel(Math.max(levelIndex ?? 0, 0)).color;

  // Mirror of the wrap prop for the rAF loop (mode only changes between runs).
  const wrapRef = useRef(wrap);

  // Handles onto the mutable parts of the scene, populated by the mount effect.
  // The theme effect below recolors these in place rather than rebuilding the
  // scene — teardown/rebuild would re-run the full disposal path every level.
  const sceneRef = useRef(null);

  // Cosmetic state the rAF loop reads (the item objects, not just ids).
  const cosRef = useRef({ skin: null, tail: null, tailObj: null, fx: null });

  const animRef = useRef({
    prevCell: { x: 0, y: 0 }, startMs: 0, headIdx: -1,
    lastTickMs: null, interpDuration: 270,
    prevFood: null, prevState: 'idle',
    particles: [], shake: null,
    slitherT: 0, lastFrameMs: null,   // tongue-flick clock (advances only while running)
    steps: 0,                         // grid steps taken; pins the slither wave to the ground
    visLen: null, headAng: null,      // drawn body length, smoothed head heading
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFShadowMap;  // PCFSoftShadowMap was removed in three r186

    // ── Scene ─────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2f5e22);  // grass green backdrop (edges)

    // ── Camera (orthographic, top-down) ──────────────────────────────────────
    const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 1000);
    cam.position.set(0, 300, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);

    // ── Drawing-buffer size ──────────────────────────────────────────────────
    // Follow the canvas's real CSS size × devicePixelRatio (capped), so the
    // board stays sharp at any layout size. The frustum stays exactly the
    // board (wrap rendering depends on that); a non-square canvas gets a
    // centred square viewport rather than a stretched image.
    let applied = { width: 0, height: 0, pixelRatio: 0 };
    const resize = () => {
      const next = computeCanvasSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
      if (next.width === applied.width && next.height === applied.height
          && next.pixelRatio === applied.pixelRatio) return;
      applied = next;
      renderer.setPixelRatio(next.pixelRatio);
      renderer.setSize(next.width, next.height, false);
      const { x, y, size } = next.viewport;
      renderer.setViewport(x, y, size, size);
      renderer.setScissor(x, y, size, size);
      renderer.setScissorTest(size !== next.width || size !== next.height);
    };
    resize();
    // ResizeObserver does not fire on a pixel-ratio change (window dragged to
    // another monitor, browser zoom); the rAF loop below checks for that.
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    resizeObserver?.observe(canvas);

    // ── Lighting ─────────────────────────────────────────────────────────────
    // Daylight-neutral lighting so the grass ground renders true green
    // (the previous red/orange desert lights would tint green toward brown).
    const ambient = new THREE.AmbientLight(0xfff6ec, 0.4);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
    sun.position.set(-80, 180, -60);
    sun.castShadow = true;
    // Shadow box: the shadow camera looks along the (tilted) light direction, so
    // its box must cover the board's corners as seen from the light, not just
    // its half-width — otherwise shadows are cut diagonally at all four corners.
    // shadowHalfExtent projects the board volume onto the light's view.
    const SHADOW_HALF = shadowHalfExtent(HALF, CELL, sun.position, CELL / 2);
    sun.shadow.camera.left   = -SHADOW_HALF;
    sun.shadow.camera.right  =  SHADOW_HALF;
    sun.shadow.camera.top    =  SHADOW_HALF;
    sun.shadow.camera.bottom = -SHADOW_HALF;
    // ~0.5 world unit per shadow texel, as on 10×10, rounded up to a power of two.
    const shadowRes = 2 ** Math.ceil(Math.log2(SHADOW_HALF * 2 * 2));
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    sun.shadow.bias = -0.001;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x6688aa, 0.2);
    fill.position.set(60, 80, 80);
    scene.add(fill);

    // ── Ground plane ─────────────────────────────────────────────────────────
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a9d3f });  // grass green field
    const ground    = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Grid lines ────────────────────────────────────────────────────────────
    const gridMat = new THREE.LineBasicMaterial({ color: 0x2c5518, opacity: 0.25, transparent: true });
    {
      const verts = [];
      for (let i = 0; i <= COLS; i++) {
        const x = i * CELL - HALF;
        verts.push(x, 0.5, -HALF,  x, 0.5, HALF);
      }
      for (let j = 0; j <= ROWS; j++) {
        const z = j * CELL - HALF;
        verts.push(-HALF, 0.5, z,  HALF, 0.5, z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      scene.add(new THREE.LineSegments(geo, gridMat));
    }

    // ── Obstacle blocks ───────────────────────────────────────────────────────
    // One InstancedMesh with fixed capacity; the visible count is set per level.
    // Instances are static within a level, so matrices are written only when the
    // layout changes — never in the rAF loop.
    const OB_H = CELL * 0.7;   // block height
    const obstacleMat  = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
    const obstacleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CELL * 0.9, OB_H, CELL * 0.9),
      obstacleMat,
      MAX_OBSTACLES,
    );
    obstacleMesh.castShadow    = true;
    obstacleMesh.receiveShadow = true;
    obstacleMesh.count         = 0;
    obstacleMesh.frustumCulled = false;
    scene.add(obstacleMesh);

    // ── Portal edges (wrap mode) ──────────────────────────────────────────────
    // One glow strip per edge: the strip is authored for the top (−Z) edge and
    // turned into place about Y, so a square board is assumed (as SIZE already
    // does). Additive + no depth write keeps it a pure light overlay.
    const GLOW_W    = CELL * 0.6;
    const portalMat = new THREE.MeshBasicMaterial({
      map: makePortalTexture(),
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const portalGeo = new THREE.PlaneGeometry(SIZE, GLOW_W);
    const portal    = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const side  = new THREE.Group();
      side.rotation.y = k * Math.PI / 2;
      const strip = new THREE.Mesh(portalGeo, portalMat);
      strip.rotation.x = -Math.PI / 2;               // lie flat; plane +Y → world −Z (the wall)
      strip.position.set(0, 0.6, -HALF + GLOW_W / 2); // just above the grid lines
      side.add(strip);
      portal.add(side);
    }
    portal.visible = wrapRef.current;
    scene.add(portal);

    // ── Snake dimensions / materials ──────────────────────────────────────────
    // BODY_R / HEAD_R / HEAD_Y / HEAD_SCALE come from snakeProfile.js, which
    // also shapes the neck so the body emerges from under the head.
    const CENTER_Y = BODY_R;        // tube centerline height → rests on ground

    const bodyTex = makeSnakeBodyTexture();
    const headTex = makeSnakeHeadTexture();

    const bodyMat = new THREE.MeshPhongMaterial({
      map: bodyTex,
      color:     0xffffff,
      specular:  0x808080,   // neutral gloss (no green cast)
      shininess: 90,
      emissive:  new THREE.Color(0x000000),
    });
    const headMat = new THREE.MeshPhongMaterial({
      map: headTex,
      color:     0xffffff,
      specular:  0x999999,   // bright neutral gloss on the black head
      shininess: 110,
      emissive:  new THREE.Color(0x000000),
    });

    // ── Body tube (regenerated in place each frame) ───────────────────────────
    // Fixed vertex/index capacity; the active length is controlled per frame via
    // setDrawRange. Vertices are laid out ring-major (ring i occupies RAD slots),
    // so the index list for the first (N-1) ring gaps is a contiguous prefix of
    // the full precomputed index list — no per-frame index rebuild, no leaks.
    const RAD       = 10;                       // radial segments per ring
    // Rings are spaced RING_STEP apart along the body, so capacity covers a
    // snake filling the whole board.
    const RING_STEP = CELL / 5;
    const MAX_RINGS = POOL_SIZE * 5 + 2;
    const BAND_PER_UNIT = 0.24 / CELL;          // ~1 coral band cycle per ~4 segments
    const HEAD_TURN_MS  = 110;                  // head heading smoothing time constant

    const tPos = new Float32Array(MAX_RINGS * RAD * 3);
    const tNor = new Float32Array(MAX_RINGS * RAD * 3);
    const tUv  = new Float32Array(MAX_RINGS * RAD * 2);
    const tIdx = new Uint16Array((MAX_RINGS - 1) * RAD * 6);
    {
      let k = 0;
      for (let i = 0; i < MAX_RINGS - 1; i++) {
        for (let j = 0; j < RAD; j++) {
          const a = i * RAD + j;
          const b = i * RAD + ((j + 1) % RAD);
          const cc = (i + 1) * RAD + j;
          const d = (i + 1) * RAD + ((j + 1) % RAD);
          tIdx[k++] = a; tIdx[k++] = cc; tIdx[k++] = b;
          tIdx[k++] = b; tIdx[k++] = cc; tIdx[k++] = d;
        }
      }
    }
    const bodyGeom = new THREE.BufferGeometry();
    bodyGeom.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    bodyGeom.setAttribute('normal',   new THREE.BufferAttribute(tNor, 3));
    bodyGeom.setAttribute('uv',       new THREE.BufferAttribute(tUv, 2));
    bodyGeom.setIndex(new THREE.BufferAttribute(tIdx, 1));
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.castShadow = true;
    scene.add(bodyMesh);

    // Wrap-mode copies of the body, one per extra tile the path touches; they
    // share the tube's buffers, so a copy costs one draw call and no upload.
    // Grown on demand, never shrunk. frustumCulled is off because the tube's
    // bounding sphere is never recomputed and would be stale once shifted.
    const bodyGhosts = [];
    const ghostBody  = (i) => {
      if (!bodyGhosts[i]) {
        const m = new THREE.Mesh(bodyGeom, bodyMat);
        m.castShadow    = true;
        m.frustumCulled = false;
        scene.add(m);
        bodyGhosts[i] = m;
      }
      return bodyGhosts[i];
    };
    const bodyTiles   = new Set();
    const headTiles   = new Set();
    const BODY_MARGIN = BODY_R + SLITHER_AMP + 2;   // tube radius + slither + slack
    const HEAD_MARGIN = CELL;                 // snout + extended tongue

    // Path vertices (segment centres, head first, unwrapped in wrap mode, plus
    // the cell the tail just left) + reusable scratch buffers (zero per-frame GC)
    const vx = new Float32Array(POOL_SIZE + 1);      // vertex X, world units
    const vz = new Float32Array(POOL_SIZE + 1);      // vertex Z, world units
    const vr = new Float32Array(POOL_SIZE + 1);      // fillet radius per vertex
    const sp = { x: 0, z: 0, tx: 0, tz: 0 };         // samplePath output
    const bx = new Float32Array(MAX_RINGS);          // ring centre X (with slither)
    const bz = new Float32Array(MAX_RINGS);          // ring centre Z (with slither)
    const bd = new Float32Array(MAX_RINGS);          // distance of each ring behind the head

    // ── Head mesh (sleek elongated wedge) + eyes + tongue ─────────────────────
    const headGeo = new THREE.SphereGeometry(HEAD_R, 24, 18);
    headGeo.scale(HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z);   // slim, flattened, elongated snout (−Z forward)
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.castShadow = true;
    scene.add(headMesh);

    // Eyes (parented to head; forward is −Z)
    const eyeGeo   = new THREE.SphereGeometry(2.2, 10, 7);
    const eyeMat   = new THREE.MeshPhongMaterial({ color: 0xf2d21a, emissive: new THREE.Color(0x352600), shininess: 90 });
    const pupilGeo = new THREE.SphereGeometry(1.05, 8, 6);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x060606 });
    // Dark eye sockets, shown only by skins that ask for them (Bone Rattler).
    const socketGeo = new THREE.SphereGeometry(3.3, 12, 9);
    const socketMat = new THREE.MeshPhongMaterial({ color: 0x000000, shininess: 10 });
    for (const s of [-1, 1]) {
      const eye   = new THREE.Mesh(eyeGeo, eyeMat);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      eye.position.set(s * HEAD_R * 0.5, HEAD_R * 0.28, -HEAD_R * 0.62);
      pupil.position.set(0, 0, eyeGeo.parameters.radius * 0.85);
      eye.add(pupil);
      headMesh.add(eye);
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.copy(eye.position).add(new THREE.Vector3(s * 0.3, 0.2, 0.7));
      socket.name    = 'socket';
      socket.visible = false;
      headMesh.add(socket);
    }

    // Hat mount on the crown of the head (hats face −Z like the head).
    const hatAnchor = new THREE.Group();
    hatAnchor.position.set(0, HEAD_R * HEAD_SCALE.y * 0.82, 1.6);
    hatAnchor.name = 'hat';
    headMesh.add(hatAnchor);

    // Flicking forked tongue (parented to head, extends from the snout tip)
    const tongueMat  = new THREE.MeshBasicMaterial({ color: 0xd11a2a });
    const tongue     = new THREE.Group();
    const tongueBase = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 5, 6), tongueMat);
    tongueBase.rotation.x = Math.PI / 2;   // align along Z
    tongueBase.position.z = -2.5;
    tongue.add(tongueBase);
    const prongGeo = new THREE.CylinderGeometry(0.45, 0.12, 4, 5);
    for (const s of [-1, 1]) {
      const prong = new THREE.Mesh(prongGeo, tongueMat);
      prong.rotation.x = Math.PI / 2;
      prong.rotation.y = s * 0.35;
      prong.position.set(s * 0.9, 0, -6);
      tongue.add(prong);
    }
    tongue.position.set(0, HEAD_R * 0.05, -HEAD_R * 1.15);
    tongue.name = 'tongue';
    headMesh.add(tongue);

    // Wrap-mode copies of the head. The head spans at most two tiles per axis
    // and one of them is always the board, so three copies cover a corner.
    const headGhosts = [];
    for (let i = 0; i < 3; i++) {
      const mesh = headMesh.clone();   // shares geometry + materials
      mesh.visible = false;
      scene.add(mesh);
      headGhosts.push({ mesh, tongue: mesh.getObjectByName('tongue') });
    }
    // Every head (board + wrap copies) with its hat mount, for the cosmetics effects.
    const heads = [headMesh, ...headGhosts.map((g) => g.mesh)];
    const hatAnchors = heads.map((h) => h.getObjectByName('hat'));

    // ── Tail decoration + followers (placed each frame at the tail tip) ───────
    const tailAnchor = new THREE.Group();
    const follower   = new THREE.Group();
    scene.add(tailAnchor, follower);

    // Round sprite shared by the stardust trail and weather layers.
    const dotTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, '#fff'); g.addColorStop(0.45, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    })();

    // Stardust trail: a ring buffer of points, faded by darkening (additive).
    const SD = 160;
    const sdPos = new Float32Array(SD * 3), sdCol = new Float32Array(SD * 3);
    const sdLife = new Float32Array(SD), sdHue = new Float32Array(SD);
    const sdGeo = new THREE.BufferGeometry();
    sdGeo.setAttribute('position', new THREE.BufferAttribute(sdPos, 3));
    sdGeo.setAttribute('color',    new THREE.BufferAttribute(sdCol, 3));
    const stardust = new THREE.Points(sdGeo, new THREE.PointsMaterial({
      size: 6, map: dotTex, vertexColors: true, sizeAttenuation: false,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    stardust.frustumCulled = false;
    stardust.visible = false;
    scene.add(stardust);
    let sdNext = 0;

    // Weather layer for the chosen board (FX in cosmetics/boards.js).
    const WX = 200;
    const wxPos = new Float32Array(WX * 3), wxVel = new Float32Array(WX * 3), wxCol = new Float32Array(WX * 3);
    const wxGeo = new THREE.BufferGeometry();
    wxGeo.setAttribute('position', new THREE.BufferAttribute(wxPos, 3));
    wxGeo.setAttribute('color',    new THREE.BufferAttribute(wxCol, 3));
    const wxMat = new THREE.PointsMaterial({ size: 4, map: dotTex, vertexColors: true, sizeAttenuation: false, transparent: true, depthWrite: false });
    const weather = new THREE.Points(wxGeo, wxMat);
    weather.frustumCulled = false;
    weather.visible = false;
    scene.add(weather);
    const setWeather = (fx) => {
      cosRef.current.fx = fx;
      weather.visible = !!fx;
      if (!fx) return;
      let seed = 42;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      wxMat.blending = fx.add ? THREE.AdditiveBlending : THREE.NormalBlending;
      wxMat.size = fx.size + 1;
      wxMat.needsUpdate = true;
      for (let i = 0; i < WX; i++) {
        tmpColor.set(fx.cols[i % fx.cols.length]);
        wxCol.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
        if (i >= fx.n) { wxPos.set([0, -999, 0], i * 3); continue; }
        wxPos.set([(r() - 0.5) * SIZE, r() * fx.area, (r() - 0.5) * SIZE], i * 3);
        wxVel.set(fx.spawn(r), i * 3);
      }
      wxGeo.attributes.position.needsUpdate = true;
      wxGeo.attributes.color.needsUpdate    = true;
    };

    // ── Mine mesh (food) ──────────────────────────────────────────────────────
    const MINE_R = CELL * 0.35;
    const MINE_Y = MINE_R * 0.8;

    const mineMat = new THREE.MeshPhongMaterial({
      color: 0x1a1a1a, specular: 0x666666, shininess: 90,
      emissive: new THREE.Color(0x0a0a0a),
    });
    const mineGroup = new THREE.Group();
    mineGroup.add(new THREE.Mesh(new THREE.SphereGeometry(MINE_R, 18, 14), mineMat));

    // 8 spike protrusions
    const spikeGeo = new THREE.ConeGeometry(1.8, 5, 6);
    const spikeMat = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, specular: 0x888888, shininess: 60 });
    const spikeDir = [
      [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],
      [0,0,1],[0,0,-1],[0.7,0.7,0],[0,-0.7,0.7],
    ];
    for (const [sx, sy, sz] of spikeDir) {
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.position.set(sx * MINE_R, sy * MINE_R, sz * MINE_R);
      spike.lookAt(spike.position.clone().multiplyScalar(2));
      spike.castShadow = true;
      mineGroup.add(spike);
    }

    // Red detonator blinker
    const detGeo = new THREE.SphereGeometry(1.5, 8, 6);
    const detMat = new THREE.MeshPhongMaterial({
      color: 0xff0000, emissive: new THREE.Color(0x400000), shininess: 100,
    });
    const detonator = new THREE.Mesh(detGeo, detMat);
    detonator.position.y = MINE_R + 1.5;
    mineGroup.add(detonator);

    mineGroup.visible = false;
    scene.add(mineGroup);

    // ── Eat point-light flash ─────────────────────────────────────────────────
    const eatLight = new THREE.PointLight(0xff4400, 0, CELL * 4, 2);
    eatLight.position.y = 20;
    scene.add(eatLight);

    // ── Particle system ───────────────────────────────────────────────────────
    const MAX_P   = 150;
    const pPos    = new Float32Array(MAX_P * 3);
    const pColors = new Float32Array(MAX_P * 3);
    const pGeo    = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color',    new THREE.BufferAttribute(pColors, 3));
    pGeo.setDrawRange(0, 0);
    const pMat    = new THREE.PointsMaterial({ size: 5, vertexColors: true, sizeAttenuation: false, transparent: true });
    scene.add(new THREE.Points(pGeo, pMat));

    const tmpColor  = new THREE.Color();
    const EXPLODE_C = new THREE.Color(0xff4400);

    // ── Tube builder ──────────────────────────────────────────────────────────
    // Samples the path (vx/vz/vr, nV vertices) at N rings spread over `total`
    // units behind the head at `hDist`, applies the slither offset + taper,
    // and writes positions/normals/uvs in place.
    const buildTube = (N, total, hDist, headAbs, nV) => {
      // Pass 1: ring centres — the path point at each distance behind the head,
      // pushed sideways by the ground-pinned slither wave.
      for (let i = 0; i < N; i++) {
        const d = (i / (N - 1)) * total;
        samplePath(vx, vz, vr, nV, hDist + d, sp);
        const off = slitherOffset(d, total, headAbs);
        bx[i] = sp.x - sp.tz * off;
        bz[i] = sp.z + sp.tx * off;
        bd[i] = d;
      }
      // Pass 2: tangent → perpendicular → ring of RAD verts
      for (let i = 0; i < N; i++) {
        const s  = total > 0 ? bd[i] / total : 0;
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(N - 1, i + 1);
        let tx = bx[i1] - bx[i0];
        let tz = bz[i1] - bz[i0];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const px = -tz, pz = tx;                       // horizontal perpendicular
        const cx = bx[i], cz = bz[i];

        // Radius: taper neck→tail, round the very tip to a point; near the head
        // the neck profile narrows and lowers the tube so it starts inside the
        // head and emerges from under its back instead of cutting across it.
        let R = BODY_R * (1 - 0.72 * s);
        R *= Math.min(1, (1 - s) / 0.06);
        const neck = neckProfile(bd[i], R);
        R = neck.r;
        const cy = neck.y + (CENTER_Y - BODY_R);   // = neck.y; kept explicit if CENTER_Y changes

        const base = i * RAD;
        for (let j = 0; j < RAD; j++) {
          const th = (j / RAD) * Math.PI * 2;
          const ct = Math.cos(th), st = Math.sin(th);
          const nx = ct * px, ny = st, nz = ct * pz;   // radial (= normal) dir
          const vi = (base + j) * 3;
          tPos[vi]     = cx + nx * R;
          tPos[vi + 1] = cy + ny * R;
          tPos[vi + 2] = cz + nz * R;
          tNor[vi]     = nx; tNor[vi + 1] = ny; tNor[vi + 2] = nz;
          // Bands are fixed to the skin by distance and start where the neck
          // leaves the head, so the yellow collar sits right behind the head.
          const ui = (base + j) * 2;
          tUv[ui]     = (bd[i] - NECK_EXIT) * BAND_PER_UNIT;
          tUv[ui + 1] = j / RAD;
        }
      }

      bodyGeom.attributes.position.needsUpdate = true;
      bodyGeom.attributes.normal.needsUpdate   = true;
      bodyGeom.attributes.uv.needsUpdate        = true;
      bodyGeom.setDrawRange(0, (N - 1) * RAD * 6);
    };

    // Publish the recolorable handles for the theme effect below. Set before the
    // first frame so a level applied on mount (via ?level=N) is never missed.
    sceneRef.current = {
      scene, groundMat, gridMat, ambient, sun, fill,
      mineMat, obstacleMat,
      portal, portalMat,
      // cosmetics
      bodyMat, headMat, eyeMat, bodyTex, headTex, heads, hatAnchors,
      tailAnchor, follower, stardust, setWeather,
      texCache: new Map(),   // skin id / 'ground:<board id>' → textures
    };

    // ── Obstacle instances ───────────────────────────────────────────────────
    // The engine's record can change without a level change (deferred walls
    // drop in mid-level once the snake clears their cell), so the loop compares
    // the record's version each frame and rewrites the instance matrices only
    // when it moved. Obstacles come from the engine's ref, not from getLevel():
    // the two legitimately differ while walls are pending.
    let drawnObstacleVersion = -1;
    const obstacleMatrix = new THREE.Matrix4();
    const syncObstacles = (record) => {
      const cells = record?.cells ?? [];
      const n = Math.min(cells.length, obstacleMesh.instanceMatrix.count);
      for (let i = 0; i < n; i++) {
        obstacleMatrix.setPosition(worldX(cells[i].x), OB_H / 2, worldZ(cells[i].y));
        obstacleMesh.setMatrixAt(i, obstacleMatrix);
      }
      obstacleMesh.count = n;
      obstacleMesh.instanceMatrix.needsUpdate = true;
      drawnObstacleVersion = record?.version ?? -1;
    };

    // ── rAF loop ──────────────────────────────────────────────────────────────
    let stopped = false;
    let rafId;
    let tubeRings = 0;                     // rings in the current tube (tail placement)
    const scratch = new THREE.Vector3();

    const loop = () => {
      if (stopped) return;
      if (Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) !== applied.pixelRatio) resize();
      const obstacles = obstaclesRef?.current;
      if (obstacles && obstacles.version !== drawnObstacleVersion) syncObstacles(obstacles);
      const now      = performance.now();
      const anim     = animRef.current;
      const food     = foodRef.current;
      const headIdx  = headIdxRef.current;
      const snakeLen = snakeLenRef.current;
      const state    = stateRef.current;
      const wrap     = wrapRef.current;

      // Advance slither phase only while actively moving (freeze when idle/paused/dead)
      const dt = anim.lastFrameMs === null ? 16 : now - anim.lastFrameMs;
      anim.lastFrameMs = now;
      if (state === 'running') anim.slitherT += dt;

      // ── Head interpolation ────────────────────────────────────────────────
      const head = segPool[headIdx % POOL_SIZE];
      if (anim.headIdx !== headIdx) {
        const measured = anim.lastTickMs !== null ? now - anim.lastTickMs : anim.interpDuration;
        // Full tick, not a fraction of it: the head moves at constant speed and
        // arrives as the next step starts instead of stopping at every cell.
        anim.interpDuration = Math.min(Math.max(measured, 40), 400);
        const ph = segPool[(anim.headIdx < 0 ? headIdx : anim.headIdx) % POOL_SIZE];
        anim.prevCell   = { x: ph.x, y: ph.y };
        anim.startMs    = now;
        anim.headIdx    = headIdx;
        anim.lastTickMs = now;
        anim.steps++;
      }
      const t    = Math.min(1, (now - anim.startMs) / anim.interpDuration);  // linear: constant speed
      let dxR    = head.x - anim.prevCell.x;
      let dyR    = head.y - anim.prevCell.y;
      if (wrap) { dxR = wrapDelta(dxR, COLS); dyR = wrapDelta(dyR, ROWS); }
      const skip = Math.abs(dxR) > 1 || Math.abs(dyR) > 1;
      // In wrap mode hxF/hyF may run up to one cell off the board mid-step.
      const hxF  = skip ? head.x : anim.prevCell.x + dxR * t;
      const hyF  = skip ? head.y : anim.prevCell.y + dyR * t;
      // Step progress for the path: 1 (head on its cell) when it did not move.
      const e    = skip || (dxR === 0 && dyR === 0) ? 1 : t;

      // ── Death shake ────────────────────────────────────────────────────────
      if (state === 'dead' && anim.prevState !== 'dead') {
        anim.shake = { startMs: now, duration: 500 };
      }
      anim.prevState = state;

      let shakeX = 0, shakeZ = 0;
      if (anim.shake) {
        const st = (now - anim.shake.startMs) / anim.shake.duration;
        if (st >= 1) {
          anim.shake = null;
        } else {
          const amp = 5 * (1 - st);
          shakeX = amp * Math.sin(st * 40);
          shakeZ = amp * Math.cos(st * 38);
        }
      }
      cam.position.x = shakeX;
      cam.position.z = shakeZ;

      // ── Eat detection ──────────────────────────────────────────────────────
      if (anim.prevFood === null) {
        anim.prevFood = { x: food.x, y: food.y };
      } else if (anim.prevFood.x !== food.x || anim.prevFood.y !== food.y) {
        const fwp = cellToWorld(anim.prevFood.x, anim.prevFood.y, 20);
        eatLight.position.set(fwp.x, fwp.y, fwp.z);
        eatLight.intensity = 4;
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
          const spd   = 1.5 + Math.random() * 2.0;
          anim.particles.push({
            ox: fwp.x, oy: 5, oz: fwp.z,
            vx: Math.cos(angle) * spd, vy: 1.5 + Math.random(), vz: Math.sin(angle) * spd,
            startMs: now, duration: 450 + Math.random() * 200,
          });
          if (anim.particles.length > MAX_P) anim.particles.shift();
        }
        anim.prevFood = { x: food.x, y: food.y };
      }

      if (eatLight.intensity > 0) {
        eatLight.intensity = Math.max(0, eatLight.intensity - 0.2);
      }

      // ── Build the body path (head → tail) ────────────────────────────────
      // Vertex k is segment k's cell centre; vertex snakeLen is the cell the
      // tail just left, which the tail is still sliding out of. In wrap mode
      // the chain is unwrapped: each vertex is shifted by whole boards to sit
      // next to its predecessor (ux/uz), so the path stays continuous.
      const nV = Math.min(snakeLen + 1, POOL_SIZE);
      let ux = head.x, uz = head.y, pux = ux, puz = uz;   // vertex k−1 and k−2, grid units
      vx[0] = worldX(ux); vz[0] = worldZ(uz);
      for (let k = 1; k < nV; k++) {
        const seg = segPool[(headIdx + k) % POOL_SIZE];
        let sx = seg.x, sz = seg.y;
        if (wrap) {
          sx += COLS * Math.round((ux - sx) / COLS);
          sz += ROWS * Math.round((uz - sz) / ROWS);
        }
        if (k === snakeLen && k >= 2 && Math.abs(sx - ux) + Math.abs(sz - uz) !== 1) {
          // Slot past the tail is stale (fresh game): extend the last leg.
          sx = 2 * ux - pux;
          sz = 2 * uz - puz;
        }
        pux = ux; puz = uz; ux = sx; uz = sz;
        vx[k] = worldX(sx); vz[k] = worldZ(sz);
      }

      // Head sits CELL·(1 − e) along the path, between vertex 1 and vertex 0.
      const hDist   = CELL * (1 - e);
      const headAbs = (anim.steps - 1 + e) * CELL;
      filletRadii(vx, vz, vr, nV, hDist);

      // Drawn length eases out by one cell over a step after eating (the tail
      // waits on its cell) instead of the tail jumping back.
      const bodyLen = (snakeLen - 1) * CELL;
      if (anim.visLen === null || skip || anim.visLen > bodyLen) anim.visLen = bodyLen;
      else if (state === 'running') anim.visLen = Math.min(bodyLen, anim.visLen + CELL * dt / anim.interpDuration);

      if (snakeLen >= 2 && nV >= 2) {
        const N = Math.max(2, Math.min(MAX_RINGS, Math.ceil(anim.visLen / RING_STEP) + 1));
        buildTube(N, anim.visLen, hDist, headAbs, nV);
        bodyMesh.visible = true;
        tubeRings = N;
      } else {
        bodyMesh.visible = false;
        tubeRings = 0;
      }

      // Body copies: tile (kx,kz) of the unwrapped path is shown on the board by
      // shifting it back by (−kx, −kz) boards. bodyMesh itself covers tile (0,0).
      let ghostsUsed = 0;
      if (wrap && snakeLen >= 2) {
        bodyTiles.clear();
        for (let k = 0; k < nV; k++) addTiles(bodyTiles, vx[k], vz[k], BODY_MARGIN);
        for (const key of bodyTiles) {
          if (key === ORIGIN_TILE) continue;
          const kx = Math.floor(key / 1024) - TILE_BIAS;
          const kz = (key % 1024) - TILE_BIAS;
          const m  = ghostBody(ghostsUsed++);
          m.position.set(-kx * SIZE, 0, -kz * SIZE);
          m.visible = true;
        }
      }
      for (let i = ghostsUsed; i < bodyGhosts.length; i++) bodyGhosts[i].visible = false;

      // ── Head placement + orientation ────────────────────────────────────────
      const hwp = cellToWorld(hxF, hyF, HEAD_Y);
      headMesh.position.set(hwp.x, hwp.y, hwp.z);
      if (snakeLen > 1 && nV >= 2) {
        // Face along the path (forward = −tangent), eased so a 90° turn reads
        // as a turn of the head rather than a snap. Head geometry faces −Z
        // (eyes + tongue on the −Z snout), so the snout points along (dx,dz)
        // at atan2(−dx,−dz).
        samplePath(vx, vz, vr, nV, hDist, sp);
        const target = Math.atan2(sp.tx, sp.tz);
        if (anim.headAng === null || skip) anim.headAng = target;
        else {
          const d = Math.atan2(Math.sin(target - anim.headAng), Math.cos(target - anim.headAng));
          anim.headAng += d * (1 - Math.exp(-dt / HEAD_TURN_MS));
        }
        headMesh.rotation.y = anim.headAng;
      }

      // Tongue flick: extend for ~180ms roughly every 1.6s while running
      const flickPhase = (anim.slitherT % 1600) / 1600;
      const flicking   = state === 'running' && flickPhase < 0.11;
      tongue.visible   = flicking;

      // Head copies — same tile scheme as the body, around the head only.
      let headsUsed = 0;
      if (wrap) {
        headTiles.clear();
        addTiles(headTiles, hwp.x, hwp.z, HEAD_MARGIN);
        for (const key of headTiles) {
          if (key === ORIGIN_TILE || headsUsed >= headGhosts.length) continue;
          const kx = Math.floor(key / 1024) - TILE_BIAS;
          const kz = (key % 1024) - TILE_BIAS;
          const g  = headGhosts[headsUsed++];
          g.mesh.position.set(hwp.x - kx * SIZE, hwp.y, hwp.z - kz * SIZE);
          g.mesh.rotation.y = headMesh.rotation.y;
          g.tongue.visible  = flicking;
          g.mesh.visible    = true;
        }
      }
      for (let i = headsUsed; i < headGhosts.length; i++) headGhosts[i].mesh.visible = false;

      // ── Cosmetics ─────────────────────────────────────────────────────────
      const cos   = cosRef.current;
      const clock = now / 1000;
      if (cos.skin?.scroll && bodyMat.map) bodyMat.map.offset.x = (bodyMat.map.offset.x - dt / 1000 * cos.skin.scroll) % 1;
      if (cos.skin?.glowPulse) bodyMat.emissiveIntensity = 0.75 + 0.35 * Math.sin(clock * 3.2);
      for (const a of hatAnchors) {
        const ring = a.getObjectByName('halo-ring');
        if (ring) ring.position.y = 9 + Math.sin(clock * 2.4) * 0.9;
      }

      // Tail decoration sits ~5 units in from the tip, facing away from the body.
      const tailOn = bodyMesh.visible && cos.tailObj !== null && tubeRings >= 3;
      tailAnchor.visible = follower.visible = tailOn;
      if (tailOn) {
        const N  = tubeRings;
        const j  = Math.min(N - 1, Math.max(1, Math.round((anim.visLen - 5) / anim.visLen * (N - 1))));
        let dx = bx[j] - bx[j - 1], dz = bz[j] - bz[j - 1];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        // Unwrapped (wrap mode) coordinates are folded back onto the board.
        const fold = (v) => (wrap ? ((((v + HALF) % SIZE) + SIZE) % SIZE) - HALF : v);
        const yaw  = Math.atan2(dx, dz);
        tailAnchor.position.set(fold(bx[j]), 2, fold(bz[j]));
        tailAnchor.rotation.y = yaw;
        const u = cos.tailObj.userData;
        if (u.shake)   cos.tailObj.rotation.y = Math.sin(clock * 48) * 0.16 * (Math.sin(clock * 0.9) > 0.2 ? 1 : 0.15);
        if (u.swing)   u.swing.rotation.x = Math.sin(clock * 6) * 0.35;
        if (u.flicker) u.flicker.forEach((m, i) => { const f = 0.85 + Math.sin(clock * (17 + i * 5) + i) * 0.12 + Math.random() * 0.06; m.scale.set(f, f * (1 + i * 0.05), f); });
        if (u.spin)    u.spin.rotation.y += dt / 1000 * 3;
        if (u.boing)   { const b = 1 + Math.sin(clock * 9) * 0.08; cos.tailObj.scale.set(b, 2 - b, b); }
        if (cos.tail?.follower) {
          const back = cos.tail.hop ? 12 : 16;
          follower.position.set(
            fold(bx[j] + dx * back),
            cos.tail.hop ? Math.abs(Math.sin(clock * 7)) * 4 : 13 + Math.sin(clock * 2.6) * 2.2,
            fold(bz[j] + dz * back),
          );
          follower.rotation.y = yaw + (cos.tail.hop ? 0 : Math.sin(clock * 1.3) * 0.25);
        }
        if (cos.tail?.emitter) {
          tailAnchor.updateMatrixWorld();
          scratch.set(0, 2.5, 3.5).applyMatrix4(tailAnchor.matrixWorld);
          for (let k = 0; k < 2; k++) {
            const i = sdNext; sdNext = (sdNext + 1) % SD;
            sdPos.set([scratch.x + (Math.random() - 0.5) * 5, scratch.y + (Math.random() - 0.5) * 4, scratch.z + (Math.random() - 0.5) * 5], i * 3);
            sdLife[i] = 1; sdHue[i] = Math.random();
          }
        }
      }
      if (stardust.visible) {
        for (let i = 0; i < SD; i++) {
          if (sdLife[i] <= 0) { sdCol[i * 3] = sdCol[i * 3 + 1] = sdCol[i * 3 + 2] = 0; continue; }
          sdLife[i] -= dt / 1000 * 0.9;
          tmpColor.setHSL(0.12 + sdHue[i] * 0.1, 1, 0.6).multiplyScalar(Math.max(0, sdLife[i]));
          sdCol[i * 3] = tmpColor.r; sdCol[i * 3 + 1] = tmpColor.g; sdCol[i * 3 + 2] = tmpColor.b;
        }
        sdGeo.attributes.position.needsUpdate = true;
        sdGeo.attributes.color.needsUpdate    = true;
      }
      if (cos.fx) {
        const fx = cos.fx, step = Math.min(dt, 50) / 1000;
        for (let i = 0; i < fx.n; i++) {
          const k = i * 3;
          wxPos[k]     += (wxVel[k] + Math.sin(clock * 1.3 + i) * fx.sway) * step;
          wxPos[k + 1] += wxVel[k + 1] * step;
          wxPos[k + 2] += (wxVel[k + 2] + Math.cos(clock * 1.1 + i * 1.7) * fx.sway) * step;
          if (fx.rise ? wxPos[k + 1] > fx.area : wxPos[k + 1] < 0) wxPos[k + 1] = fx.rise ? 0 : fx.area;
          if (Math.abs(wxPos[k]) > HALF) wxPos[k] = -Math.sign(wxPos[k]) * HALF;
          if (Math.abs(wxPos[k + 2]) > HALF) wxPos[k + 2] = -Math.sign(wxPos[k + 2]) * HALF;
        }
        wxGeo.attributes.position.needsUpdate = true;
      }

      // Portal glow pulse
      if (portal.visible) portalMat.opacity = 0.55 + 0.25 * Math.sin(now * 0.004);

      // ── Mine (food) ────────────────────────────────────────────────────────
      const mwp = cellToWorld(food.x, food.y, MINE_Y);
      mineGroup.position.set(mwp.x, mwp.y, mwp.z);
      mineGroup.rotation.y += 0.012;
      mineGroup.visible = true;
      // Blink detonator
      const blink = (Math.sin(now * 0.008) + 1) / 2;
      detMat.emissive.setRGB(blink * 0.8, 0, 0);

      // ── Particles ─────────────────────────────────────────────────────────
      anim.particles = anim.particles.filter(p => (now - p.startMs) < p.duration);
      let pi = 0;
      for (const p of anim.particles) {
        const pt = (now - p.startMs) / p.duration;
        tmpColor.copy(EXPLODE_C);
        pPos[pi * 3]     = p.ox + p.vx * pt * p.duration * 0.055;
        pPos[pi * 3 + 1] = p.oy + p.vy * pt * 14 - 9.8 * pt * pt * 10;
        pPos[pi * 3 + 2] = p.oz + p.vz * pt * p.duration * 0.055;
        pColors[pi * 3]     = tmpColor.r;
        pColors[pi * 3 + 1] = tmpColor.g;
        pColors[pi * 3 + 2] = tmpColor.b;
        pi++;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate    = true;
      pGeo.setDrawRange(0, pi);
      pMat.opacity = 0.9;

      renderer.render(scene, cam);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      // Release all GPU resources. renderer.dispose() alone does NOT free
      // geometries, materials, or textures — walk the scene and dispose them
      // explicitly to avoid a GPU-memory leak on unmount / StrictMode remount.
      // (bodyGeom and the CanvasTextures are reached here via bodyMesh and
      // material.map, so no separate disposal is needed. Resources shared by the
      // wrap-mode copies are disposed more than once, which three.js tolerates.)
      scene.traverse((obj) => {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          m.map?.dispose();
          m.dispose();
        }
      });
      for (const t of sceneRef.current?.texCache.values() ?? []) { t.map?.dispose(); t.glow?.dispose(); }
      bodyTex.dispose(); headTex.dispose(); dotTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wrap mode ───────────────────────────────────────────────────────────────
  // Declared after the mount effect so sceneRef is populated on first run.
  useEffect(() => {
    wrapRef.current = wrap;
    if (sceneRef.current) sceneRef.current.portal.visible = wrap;
  }, [wrap]);

  // ── Per-level theme / board ──────────────────────────────────────────────────
  // Runs on mount (after the effect above, which is declared first), on every
  // level change and when the player picks a board. Mutates materials and
  // lights in place; the scene graph itself is never rebuilt. The 'level'
  // board is the level theme as is; any other board overrides its look.
  const boardId = loadout.board;
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    const level     = getLevel(Math.max(levelIndex ?? 0, 0));
    const { theme } = level;
    const board     = findItem('board', boardId);
    const custom    = board && board.id !== 'level';
    s.scene.background.set(custom ? board.bg : theme.bg);
    let groundMap = null;
    if (custom) {
      const key = `ground:${board.id}`;
      if (!s.texCache.has(key)) {
        const c = paintGround(board);
        const map = c ? new THREE.CanvasTexture(c) : null;
        if (map) map.colorSpace = THREE.SRGBColorSpace;
        s.texCache.set(key, { map });
      }
      groundMap = s.texCache.get(key).map;
    }
    if (s.groundMat.map !== groundMap) { s.groundMat.map = groundMap; s.groundMat.needsUpdate = true; }
    s.groundMat.color.set(groundMap ? 0xffffff : custom ? board.ground : theme.ground);
    s.gridMat.color.set(custom ? board.grid : theme.grid);
    s.gridMat.opacity = custom ? board.gridOp : 0.25;
    s.ambient.color.set(custom ? board.ambient : theme.ambient);
    s.sun.color.set(custom ? board.sun : theme.sun);
    s.fill.color.set(theme.fill);
    s.mineMat.color.set(theme.food);
    s.obstacleMat.color.set(custom ? board.obstacle : theme.obstacle);
    s.obstacleMat.emissive.set(custom && board.obstacleGlow ? board.obstacleGlow : 0x000000);
    s.portalMat.color.set(level.color);
    s.setWeather(custom && board.fx ? FX[board.fx] : null);
    // Obstacle instances are synced by the rAF loop from the engine's record
    // version — see syncObstacles in the mount effect.
  }, [levelIndex, boardId]);

  // ── Skin ─────────────────────────────────────────────────────────────────────
  const skinId = loadout.skin;
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const skin = findItem('skin', skinId) ?? findItem('skin', 'coral');
    cosRef.current.skin = skin;
    const { bodyMat, headMat, eyeMat } = s;
    if (skin.builtin) {
      bodyMat.map = s.bodyTex; bodyMat.emissiveMap = null;
      bodyMat.specular.set(0x808080); bodyMat.shininess = 90;
      headMat.map = s.headTex; headMat.color.set(0xffffff);
      headMat.specular.set(0x999999); headMat.shininess = 110;
    } else {
      if (!s.texCache.has(skin.id)) {
        const painted = paintSkin(skin);
        const tex = (c) => {
          if (!c) return null;
          const t = new THREE.CanvasTexture(c);
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = THREE.SRGBColorSpace;
          // Body UVs advance BAND_PER_UNIT (0.24 per cell); one tile spans `ulen` cells.
          t.repeat.x = 1 / ((skin.ulen ?? 2) * 0.24);
          return t;
        };
        s.texCache.set(skin.id, { map: tex(painted?.map), glow: tex(painted?.glow) });
      }
      const t = s.texCache.get(skin.id);
      bodyMat.map = t.map; bodyMat.emissiveMap = t.glow;
      bodyMat.specular.set(skin.head.spec); bodyMat.shininess = Math.min(skin.head.shin, 120);
      headMat.map = null; headMat.color.set(skin.head.color);
      headMat.specular.set(skin.head.spec); headMat.shininess = skin.head.shin;
    }
    bodyMat.emissive.set(bodyMat.emissiveMap ? 0xffffff : 0x000000);
    bodyMat.emissiveIntensity = 1;
    bodyMat.needsUpdate = headMat.needsUpdate = true;
    eyeMat.color.set(skin.builtin ? 0xf2d21a : skin.eye.color);
    eyeMat.emissive.set(skin.builtin ? 0x352600 : skin.eye.glow);
    for (const h of s.heads) h.traverse((o) => { if (o.name === 'socket') o.visible = !!skin.eye?.socket; });
  }, [skinId]);

  // ── Hat ──────────────────────────────────────────────────────────────────────
  const hatId = loadout.hat;
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const hat = findItem('hat', hatId);
    if (!hat || hat.id === 'none') return;
    const built = hat.build();
    built.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // The board head wears the original; wrap-mode head copies share its geometry.
    const worn = s.hatAnchors.map((a, i) => { const h = i === 0 ? built : built.clone(); a.add(h); return h; });
    return () => {
      worn.forEach((h) => h.removeFromParent());
      built.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    };
  }, [hatId]);

  // ── Tail decoration ──────────────────────────────────────────────────────────
  const tailId = loadout.tail;
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const tail = findItem('tail', tailId);
    if (!tail || tail.id === 'none') return;
    const built = tail.build();
    const cos   = cosRef.current;
    (tail.follower ? s.follower : s.tailAnchor).add(built);
    s.stardust.visible = !!tail.emitter;
    cos.tail = tail;
    cos.tailObj = built;
    return () => {
      built.removeFromParent();
      built.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      s.stardust.visible = false;
      cos.tail = null;
      cos.tailObj = null;
    };
  }, [tailId]);

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
