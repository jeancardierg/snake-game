/**
 * GameCanvas — WebGL renderer using three.js.
 *
 * Draws the snake game board in full 3D with:
 *   - Snake body: one continuous, tapered tube generated each frame from a
 *     Catmull-Rom spline through the interpolated segment centers, with a
 *     subtle lateral "slither" wave (amplitude ramps from 0 at the head so the
 *     head stays grid-accurate) and glossy procedural scale texture
 *   - Sleek wedge head oriented along the body, with eyes + a flicking tongue
 *   - Mine food: dark metallic sphere with spike protrusions and blinking
 *     red detonator
 *   - Grass-green ground plane + grid lines
 *   - Directional sun + ambient + fill lights, PCFSoft shadow map
 *   - Point-light flash on eat, particle burst, camera shake on death
 *
 * All game state is read from refs every frame (no React reconciliation per tick).
 * The three.js scene is created once on mount and torn down on unmount.
 *
 * Rendering-only module: game logic (useSnake.js) is untouched. The slither and
 * smooth tube are a visual layer over the existing grid path — the head always
 * resolves to its exact cell so food/eat alignment is preserved.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { COLS, ROWS, CELL, LEVELS } from '../constants';
import { segPool, POOL_SIZE } from '../pool';

const SIZE = COLS * CELL;   // 200 logical units
const HALF = SIZE / 2;      // 100

// Grid cell (col,row) → world X / Z (Y is height). Scalar variants avoid the
// per-call Vector3 allocation of cellToWorld inside the hot centerline loop.
function worldX(col) { return col * CELL - HALF + CELL / 2; }
function worldZ(row) { return row * CELL - HALF + CELL / 2; }

// Map grid cell (col, row) to world XZ position (Y=height)
function cellToWorld(col, row, height = 0) {
  return new THREE.Vector3(worldX(col), height, worldZ(row));
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
export function GameCanvas({ headIdxRef, snakeLenRef, foodRef, levelIndex, stateRef, scoreRef }) { // eslint-disable-line no-unused-vars
  const canvasRef     = useRef(null);
  const color         = LEVELS[levelIndex]?.color ?? '#4ecca3';
  const levelIndexRef = useRef(levelIndex);
  useEffect(() => { levelIndexRef.current = levelIndex; }, [levelIndex]);

  const animRef = useRef({
    prevCell: { x: 0, y: 0 }, startMs: 0, headIdx: -1,
    lastTickMs: null, interpDuration: 270,
    prevFood: null, prevState: 'idle',
    particles: [], shake: null,
    slitherT: 0, lastFrameMs: null,   // slither wave phase (advances only while running)
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // ── Scene ─────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2f5e22);  // grass green backdrop (edges)

    // ── Camera (orthographic, top-down) ──────────────────────────────────────
    const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 1000);
    cam.position.set(0, 300, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);

    // ── Lighting ─────────────────────────────────────────────────────────────
    // Daylight-neutral lighting so the grass ground renders true green
    // (the previous red/orange desert lights would tint green toward brown).
    const ambient = new THREE.AmbientLight(0xfff6ec, 0.4);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
    sun.position.set(-80, 180, -60);
    sun.castShadow = true;
    sun.shadow.camera.left   = -120;
    sun.shadow.camera.right  =  120;
    sun.shadow.camera.top    =  120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.mapSize.set(512, 512);
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
      scene.add(new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x2c5518, opacity: 0.25, transparent: true }),
      ));
    }

    // ── Snake dimensions / materials ──────────────────────────────────────────
    const BODY_R   = CELL * 0.34;   // max tube radius (neck)
    const HEAD_R   = CELL * 0.44;
    const CENTER_Y = BODY_R;        // tube centerline height → rests on ground
    const HEAD_Y   = HEAD_R * 0.75;

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
    const MAX_RINGS = 180;                       // capacity (rings along length)
    const A_MAX     = CELL * 0.15;               // max slither amplitude (grid-accurate)
    const WAVES     = 1.6;                        // wave count along the body

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

    // Spline through segment centers + reusable scratch buffers (zero per-frame GC)
    const centerline  = Array.from({ length: POOL_SIZE }, () => new THREE.Vector3());
    const curvePoints = [];
    const curve       = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3()]);
    curve.curveType   = 'centripetal';
    const scP         = new THREE.Vector3();
    const bx          = new Float32Array(MAX_RINGS);   // base sample X (pre-slither)
    const bz          = new Float32Array(MAX_RINGS);   // base sample Z (pre-slither)

    // ── Head mesh (sleek elongated wedge) + eyes + tongue ─────────────────────
    const headGeo = new THREE.SphereGeometry(HEAD_R, 24, 18);
    headGeo.scale(0.9, 0.66, 1.35);   // slim, flattened, elongated snout (−Z forward)
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.castShadow = true;
    scene.add(headMesh);

    // Eyes (parented to head; forward is −Z)
    const eyeGeo   = new THREE.SphereGeometry(2.2, 10, 7);
    const eyeMat   = new THREE.MeshPhongMaterial({ color: 0xf2d21a, emissive: new THREE.Color(0x352600), shininess: 90 });
    const pupilGeo = new THREE.SphereGeometry(1.05, 8, 6);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x060606 });
    for (const s of [-1, 1]) {
      const eye   = new THREE.Mesh(eyeGeo, eyeMat);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      eye.position.set(s * HEAD_R * 0.5, HEAD_R * 0.28, -HEAD_R * 0.62);
      pupil.position.set(0, 0, eyeGeo.parameters.radius * 0.85);
      eye.add(pupil);
      headMesh.add(eye);
    }

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
    headMesh.add(tongue);

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
    // Samples the current spline at N rings, applies the slither offset + taper,
    // and writes positions/normals/uvs in place. `ulen` scales scale-banding
    // along the body length.
    const buildTube = (N, slitherT, ulen) => {
      // Pass 1: base centerline samples (pre-slither) in XZ
      for (let i = 0; i < N; i++) {
        curve.getPoint(i / (N - 1), scP);
        bx[i] = scP.x; bz[i] = scP.z;
      }
      // Pass 2: tangent → perpendicular → slither offset → ring of RAD verts
      for (let i = 0; i < N; i++) {
        const s  = i / (N - 1);
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(N - 1, i + 1);
        let tx = bx[i1] - bx[i0];
        let tz = bz[i1] - bz[i0];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const px = -tz, pz = tx;                       // horizontal perpendicular

        const amp = A_MAX * Math.min(1, s / 0.25);     // 0 at head → full by 25%
        const off = amp * Math.sin(s * WAVES * Math.PI * 2 - slitherT * 0.006);
        const cx  = bx[i] + px * off;
        const cz  = bz[i] + pz * off;

        // Radius: taper neck→tail, round the very tip to a point
        let R = BODY_R * (1 - 0.72 * s);
        R *= Math.min(1, (1 - s) / 0.06);

        const base = i * RAD;
        for (let j = 0; j < RAD; j++) {
          const th = (j / RAD) * Math.PI * 2;
          const ct = Math.cos(th), st = Math.sin(th);
          const nx = ct * px, ny = st, nz = ct * pz;   // radial (= normal) dir
          const vi = (base + j) * 3;
          tPos[vi]     = cx + nx * R;
          tPos[vi + 1] = CENTER_Y + ny * R;
          tPos[vi + 2] = cz + nz * R;
          tNor[vi]     = nx; tNor[vi + 1] = ny; tNor[vi + 2] = nz;
          const ui = (base + j) * 2;
          tUv[ui]     = s * ulen;
          tUv[ui + 1] = j / RAD;
        }
      }
      bodyGeom.attributes.position.needsUpdate = true;
      bodyGeom.attributes.normal.needsUpdate   = true;
      bodyGeom.attributes.uv.needsUpdate        = true;
      bodyGeom.setDrawRange(0, (N - 1) * RAD * 6);
    };

    // ── rAF loop ──────────────────────────────────────────────────────────────
    let stopped = false;
    let rafId;

    const loop = () => {
      if (stopped) return;
      const now      = performance.now();
      const anim     = animRef.current;
      const food     = foodRef.current;
      const headIdx  = headIdxRef.current;
      const snakeLen = snakeLenRef.current;
      const state    = stateRef.current;

      // Advance slither phase only while actively moving (freeze when idle/paused/dead)
      const dt = anim.lastFrameMs === null ? 16 : now - anim.lastFrameMs;
      anim.lastFrameMs = now;
      if (state === 'running') anim.slitherT += dt;

      // ── Head interpolation ────────────────────────────────────────────────
      const head = segPool[headIdx % POOL_SIZE];
      if (anim.headIdx !== headIdx) {
        const measured = anim.lastTickMs !== null ? now - anim.lastTickMs : anim.interpDuration;
        anim.interpDuration = Math.min(Math.max(measured * 0.92, 40), 400);
        const ph = segPool[(anim.headIdx < 0 ? headIdx : anim.headIdx) % POOL_SIZE];
        anim.prevCell   = { x: ph.x, y: ph.y };
        anim.startMs    = now;
        anim.headIdx    = headIdx;
        anim.lastTickMs = now;
      }
      const t    = Math.min(1, (now - anim.startMs) / anim.interpDuration);
      const tE   = t * t * (3 - 2 * t); // smoothstep ease-in/out
      const dxR  = head.x - anim.prevCell.x;
      const dyR  = head.y - anim.prevCell.y;
      const skip = Math.abs(dxR) > 1 || Math.abs(dyR) > 1;
      const hxF  = skip ? head.x : anim.prevCell.x + dxR * tE;
      const hyF  = skip ? head.y : anim.prevCell.y + dyR * tE;

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

      // ── Build snake centerline (head → tail), interpolated ──────────────────
      centerline[0].set(worldX(hxF), CENTER_Y, worldZ(hyF));
      for (let i = 1; i < snakeLen; i++) {
        const seg = segPool[(headIdx + i) % POOL_SIZE];
        let sxF = seg.x, szF = seg.y;
        if (i < snakeLen - 1) {
          // Ring slot i+1 held this segment's position before the latest tick.
          const prev = segPool[(headIdx + i + 1) % POOL_SIZE];
          const sdx  = seg.x - prev.x;
          const sdz  = seg.y - prev.y;
          if (Math.abs(sdx) <= 1 && Math.abs(sdz) <= 1) {
            sxF = prev.x + sdx * tE;
            szF = prev.y + sdz * tE;
          }
        }
        centerline[i].set(worldX(sxF), CENTER_Y, worldZ(szF));
      }

      // Fit spline and rebuild the tube (needs ≥2 points; snake is always ≥3)
      if (snakeLen >= 2) {
        curvePoints.length = snakeLen;
        for (let i = 0; i < snakeLen; i++) curvePoints[i] = centerline[i];
        curve.points = curvePoints;
        const N = Math.max(8, Math.min(MAX_RINGS, Math.round(snakeLen * 4)));
        buildTube(N, anim.slitherT, snakeLen * 0.24);  // ~1 coral band cycle / ~4 segments
        bodyMesh.visible = true;
      } else {
        bodyMesh.visible = false;
      }

      // ── Head placement + orientation ────────────────────────────────────────
      const hwp = cellToWorld(hxF, hyF, HEAD_Y);
      headMesh.position.set(hwp.x, hwp.y, hwp.z);
      if (snakeLen > 1) {
        const neck = segPool[(headIdx + 1) % POOL_SIZE];
        const dx   = head.x - neck.x;
        const dz   = head.y - neck.y;
        const ndx  = Math.abs(dx) > 1 ? -Math.sign(dx) : dx;
        const ndz  = Math.abs(dz) > 1 ? -Math.sign(dz) : dz;
        if (ndx !== 0 || ndz !== 0) {
          // Head geometry faces −Z (eyes + tongue on the −Z snout), so the snout
          // points along the travel vector (ndx,ndz) only at atan2(−ndx,−ndz);
          // plain atan2(ndx,ndz) aims it 180° backward.
          headMesh.rotation.y = Math.atan2(-ndx, -ndz);
        }
      }

      // Tongue flick: extend for ~180ms roughly every 1.6s while running
      const flickPhase = (anim.slitherT % 1600) / 1600;
      const flicking   = state === 'running' && flickPhase < 0.11;
      tongue.visible   = flicking;

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
      // Release all GPU resources. renderer.dispose() alone does NOT free
      // geometries, materials, or textures — walk the scene and dispose them
      // explicitly to avoid a GPU-memory leak on unmount / StrictMode remount.
      // (bodyGeom and the two CanvasTextures are reached here via bodyMesh and
      // material.map, so no separate disposal is needed.)
      scene.traverse((obj) => {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          m.map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
    };
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
