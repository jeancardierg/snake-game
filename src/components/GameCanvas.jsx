/**
 * GameCanvas — WebGL renderer using three.js.
 *
 * Draws the snake game board in full 3D with:
 *   - Phong-shaded sphere segments for the snake body
 *   - Larger sphere head with slit-pupil eyes
 *   - 6 fruit types as coloured spinning spheres
 *   - Desert ground plane + grid lines
 *   - Directional sun light from upper-left + warm ambient
 *   - Point-light flash on food eat, particle burst, camera shake on death
 *
 * All game state is read from refs every frame (no React reconciliation per tick).
 * The three.js scene is created once on mount and torn down on unmount.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { COLS, ROWS, CELL, LEVELS } from '../constants';
import { segPool, POOL_SIZE } from '../pool';

const SIZE = COLS * CELL;   // 200 logical units
const HALF = SIZE / 2;      // 100

// Fruit sphere colours + specular highlights (matches FRUIT_GLOW_COLORS order)
const FRUIT_COLORS = [0xd42020, 0xf07020, 0xe02040, 0xd0a800, 0x30a020, 0x7030a0];
const FRUIT_SPEC   = [0xff8080, 0xffb060, 0xff80a0, 0xffe060, 0x70d050, 0xc070ff];

// Map grid cell (col, row) to world XZ position (Y=height)
function cellToWorld(col, row, height = 0) {
  return new THREE.Vector3(
    col * CELL - HALF + CELL / 2,
    height,
    row * CELL - HALF + CELL / 2,
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function GameCanvas({ headIdxRef, snakeLenRef, foodRef, levelIndex, stateRef, scoreRef }) { // eslint-disable-line no-unused-vars
  const canvasRef     = useRef(null);
  const color         = LEVELS[levelIndex]?.color ?? '#4ecca3';
  const levelIndexRef = useRef(levelIndex);
  useEffect(() => { levelIndexRef.current = levelIndex; }, [levelIndex]);

  // All mutable per-frame state in one ref.
  const animRef = useRef({
    prevCell: { x: 0, y: 0 }, startMs: 0, headIdx: -1,
    lastTickMs: null, interpDuration: 270,
    prevFood: null, prevState: 'idle',
    particles: [], shake: null,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(SIZE, SIZE, false); // false = don't touch CSS
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // ── Scene ─────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb89850);  // sandy desert

    // ── Camera (orthographic, top-down) ──────────────────────────────────────
    // OrthographicCamera: -HALF…+HALF in both axes → 1 unit = 1 logical pixel
    const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 1000);
    cam.position.set(0, 300, 0);
    cam.up.set(0, 0, -1);   // grid row 0 appears at top of screen
    cam.lookAt(0, 0, 0);

    // ── Lighting ─────────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffe8c8, 0.55);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfffde8, 1.1);
    sun.position.set(-80, 180, -60);
    sun.castShadow = true;
    sun.shadow.camera.left   = -120;
    sun.shadow.camera.right  =  120;
    sun.shadow.camera.top    =  120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.bias = -0.001;
    scene.add(sun);

    // Subtle fill light from opposite side
    const fill = new THREE.DirectionalLight(0xc8e8ff, 0.25);
    fill.position.set(60, 80, 80);
    scene.add(fill);

    // ── Ground plane ─────────────────────────────────────────────────────────
    const groundMat = new THREE.MeshLambertMaterial({ color: 0xc8a45a });
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
      const geo   = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      scene.add(new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x9a7a30, opacity: 0.40, transparent: true }),
      ));
    }

    // ── Snake materials ───────────────────────────────────────────────────────
    const BODY_R  = CELL * 0.41;
    const HEAD_R  = CELL * 0.47;
    const BODY_Y  = BODY_R * 0.55;   // resting height above ground
    const HEAD_Y  = HEAD_R * 0.60;

    const bodyMat = new THREE.MeshPhongMaterial({
      color:    0x4a7a2e,
      specular: 0x306020,
      shininess: 28,
      emissive:  new THREE.Color(0x081408),
    });
    const headMat = new THREE.MeshPhongMaterial({
      color:    0x3a6020,
      specular: 0x50a030,
      shininess: 55,
      emissive:  new THREE.Color(0x060e04),
    });

    // ── Segment mesh pool (one per possible snake cell) ───────────────────────
    const bodyGeo  = new THREE.SphereGeometry(BODY_R, 20, 14);
    const segMeshes = Array.from({ length: POOL_SIZE }, () => {
      const m = new THREE.Mesh(bodyGeo, bodyMat);
      m.castShadow = true;
      m.visible    = false;
      scene.add(m);
      return m;
    });

    // ── Head mesh ─────────────────────────────────────────────────────────────
    const headGeo  = new THREE.SphereGeometry(HEAD_R, 22, 16);
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.castShadow = true;
    scene.add(headMesh);

    // Eyes attached to head (parented, move + rotate with it)
    const eyeGeo   = new THREE.SphereGeometry(2.2, 10, 7);
    const eyeMat   = new THREE.MeshPhongMaterial({ color: 0xd4b820, emissive: new THREE.Color(0x302000), shininess: 80 });
    const pupilGeo = new THREE.SphereGeometry(1.1, 8, 6);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x060606 });

    for (const s of [-1, 1]) {
      const eye   = new THREE.Mesh(eyeGeo, eyeMat);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      // Eyes positioned at front of head, slightly raised
      eye.position.set(s * HEAD_R * 0.55, HEAD_R * 0.30, -HEAD_R * 0.72);
      pupil.position.set(0, 0, eyeGeo.parameters.radius * 0.85);
      eye.add(pupil);
      headMesh.add(eye);
    }

    // ── Food meshes (6 fruit types, pre-created) ──────────────────────────────
    const FOOD_R   = CELL * 0.38;
    const FOOD_Y   = FOOD_R * 0.75;
    const foodMeshes = FRUIT_COLORS.map((col, i) => {
      const mat = new THREE.MeshPhongMaterial({
        color:    col,
        specular: FRUIT_SPEC[i],
        shininess: 75,
        emissive:  new THREE.Color(col).multiplyScalar(0.12),
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(FOOD_R, 18, 13), mat);
      m.castShadow = true;
      m.visible    = false;
      scene.add(m);
      return m;
    });

    // ── Eat point-light flash ─────────────────────────────────────────────────
    const eatLight = new THREE.PointLight(0xffffff, 0, CELL * 4, 2);
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
    const pSystem = new THREE.Points(pGeo, pMat);
    scene.add(pSystem);

    // Pre-built colour objects to avoid per-frame allocation in particle loop
    const tmpColor = new THREE.Color();

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

      // ── Head interpolation ────────────────────────────────────────────────
      const head = segPool[headIdx % POOL_SIZE];
      if (anim.headIdx !== headIdx) {
        const measured = anim.lastTickMs !== null ? now - anim.lastTickMs : anim.interpDuration;
        anim.interpDuration = Math.min(Math.max(measured * 0.88, 40), 400);
        const ph = segPool[(anim.headIdx < 0 ? headIdx : anim.headIdx) % POOL_SIZE];
        anim.prevCell   = { x: ph.x, y: ph.y };
        anim.startMs    = now;
        anim.headIdx    = headIdx;
        anim.lastTickMs = now;
      }
      const t    = Math.min(1, (now - anim.startMs) / anim.interpDuration);
      const dxR  = head.x - anim.prevCell.x;
      const dyR  = head.y - anim.prevCell.y;
      const skip = Math.abs(dxR) > 1 || Math.abs(dyR) > 1;
      const hxF  = skip ? head.x : anim.prevCell.x + dxR * t;
      const hyF  = skip ? head.y : anim.prevCell.y + dyR * t;

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
        const fruitType = anim.prevFood.type ?? 0;
        const fwp = cellToWorld(anim.prevFood.x, anim.prevFood.y, 20);
        // Eat light flash
        eatLight.position.set(fwp.x, fwp.y, fwp.z);
        eatLight.color.setHex(FRUIT_COLORS[fruitType] ?? 0xffdd44);
        eatLight.intensity = 4;
        // Particle burst
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
          const spd   = 1.5 + Math.random() * 2.0;
          anim.particles.push({
            ox: fwp.x, oy: 5, oz: fwp.z,
            vx: Math.cos(angle) * spd, vy: 1.5 + Math.random(), vz: Math.sin(angle) * spd,
            r: fruitType,
            startMs: now, duration: 450 + Math.random() * 200,
          });
          if (anim.particles.length > MAX_P) anim.particles.shift();
        }
        anim.prevFood = { x: food.x, y: food.y };
      }

      // ── Eat light fade ────────────────────────────────────────────────────
      if (eatLight.intensity > 0) {
        eatLight.intensity = Math.max(0, eatLight.intensity - 0.2);
      }

      // ── Body segments ──────────────────────────────────────────────────────
      for (const m of segMeshes) m.visible = false;
      for (let i = 1; i < snakeLen; i++) {
        const seg  = segPool[(headIdx + i) % POOL_SIZE];
        const mesh = segMeshes[(headIdx + i) % POOL_SIZE];
        const wp   = cellToWorld(seg.x, seg.y, BODY_Y);
        mesh.position.set(wp.x, wp.y, wp.z);
        mesh.visible = true;
      }

      // ── Head ──────────────────────────────────────────────────────────────
      const hwp = cellToWorld(hxF, hyF, HEAD_Y);
      headMesh.position.set(hwp.x, hwp.y, hwp.z);

      // Rotate head to face direction of movement
      if (snakeLen > 1) {
        const neck = segPool[(headIdx + 1) % POOL_SIZE];
        const dx   = head.x - neck.x;
        const dz   = head.y - neck.y;
        const ndx  = Math.abs(dx) > 1 ? -Math.sign(dx) : dx;
        const ndz  = Math.abs(dz) > 1 ? -Math.sign(dz) : dz;
        if (ndx !== 0 || ndz !== 0) {
          // atan2(ndx, ndz) maps XZ movement direction to Y-axis rotation
          headMesh.rotation.y = Math.atan2(ndx, ndz);
        }
      }

      // ── Food ──────────────────────────────────────────────────────────────
      for (const m of foodMeshes) m.visible = false;
      const fruitType = food.type ?? 0;
      const fm  = foodMeshes[fruitType];
      const fwp = cellToWorld(food.x, food.y, FOOD_Y);
      fm.position.set(fwp.x, fwp.y, fwp.z);
      fm.rotation.y += 0.022;
      fm.visible = true;

      // ── Particles ─────────────────────────────────────────────────────────
      anim.particles = anim.particles.filter(p => (now - p.startMs) < p.duration);
      let pi = 0;
      for (const p of anim.particles) {
        const pt  = (now - p.startMs) / p.duration;
        tmpColor.setHex(FRUIT_COLORS[p.r] ?? 0xffdd44);
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
      renderer.dispose();
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
