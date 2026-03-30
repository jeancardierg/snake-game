/**
 * GameCanvas — WebGL renderer using three.js.
 *
 * Draws the snake game board in full 3D with:
 *   - King Cobra body: procedural canvas texture with chevron banding,
 *     continuous cylinder connectors between sphere joints, hood flare on head
 *   - Mine food: dark metallic sphere with spike protrusions and blinking
 *     red detonator
 *   - Desert ground plane + grid lines
 *   - Directional sun + ambient + fill lights, PCFSoft shadow map
 *   - Point-light flash on eat, particle burst, camera shake on death
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

// Map grid cell (col, row) to world XZ position (Y=height)
function cellToWorld(col, row, height = 0) {
  return new THREE.Vector3(
    col * CELL - HALF + CELL / 2,
    height,
    row * CELL - HALF + CELL / 2,
  );
}

// ─── Procedural cobra textures ────────────────────────────────────────────────

function makeCobraBodyTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  // Dark olive base
  ctx.fillStyle = '#2d4a1e';
  ctx.fillRect(0, 0, 64, 128);
  // Cream chevron banding
  ctx.fillStyle = '#c4b878';
  for (let row = 0; row < 8; row++) {
    const y = row * 16 + 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(32, y + 6);
    ctx.lineTo(64, y);
    ctx.lineTo(64, y + 3);
    ctx.lineTo(32, y + 9);
    ctx.lineTo(0, y + 3);
    ctx.closePath();
    ctx.fill();
  }
  // Subtle belly stripe
  ctx.fillStyle = 'rgba(232,221,184,0.22)';
  ctx.fillRect(24, 0, 16, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  return tex;
}

function makeCobraHeadTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  // Darker olive hood
  ctx.fillStyle = '#1e3a12';
  ctx.fillRect(0, 0, 64, 64);
  // Hood spectacle marking (cream V-shape)
  ctx.strokeStyle = '#c4b878';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(16, 20);
  ctx.lineTo(32, 40);
  ctx.lineTo(48, 20);
  ctx.stroke();
  // Eye-spot circles on hood
  ctx.fillStyle = '#c4b878';
  ctx.beginPath(); ctx.arc(22, 24, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(42, 24, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e3a12';
  ctx.beginPath(); ctx.arc(22, 24, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(42, 24, 2.5, 0, Math.PI * 2); ctx.fill();
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
    scene.background = new THREE.Color(0xb89850);

    // ── Camera (orthographic, top-down) ──────────────────────────────────────
    const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 1000);
    cam.position.set(0, 300, 0);
    cam.up.set(0, 0, -1);
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
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      scene.add(new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x9a7a30, opacity: 0.40, transparent: true }),
      ));
    }

    // ── Snake materials (cobra textured) ──────────────────────────────────────
    const BODY_R = CELL * 0.38;
    const HEAD_R = CELL * 0.47;
    const BODY_Y = BODY_R * 0.55;
    const HEAD_Y = HEAD_R * 0.60;

    const cobraBodyTex = makeCobraBodyTexture();
    const cobraHeadTex = makeCobraHeadTexture();

    const bodyMat = new THREE.MeshPhongMaterial({
      map: cobraBodyTex,
      color:    0x3a5a20,
      specular: 0x304a18,
      shininess: 35,
      emissive: new THREE.Color(0x0a1806),
    });
    const headMat = new THREE.MeshPhongMaterial({
      map: cobraHeadTex,
      color:    0x2a4a16,
      specular: 0x40701e,
      shininess: 50,
      emissive: new THREE.Color(0x060e04),
    });

    // ── Segment sphere pool ───────────────────────────────────────────────────
    const bodyGeo   = new THREE.SphereGeometry(BODY_R, 18, 12);
    const segMeshes = Array.from({ length: POOL_SIZE }, () => {
      const m = new THREE.Mesh(bodyGeo, bodyMat);
      m.castShadow = true;
      m.visible    = false;
      scene.add(m);
      return m;
    });

    // ── Connector cylinder pool (links adjacent segments) ─────────────────────
    const CONN_R    = BODY_R * 0.92;
    const connGeo   = new THREE.CylinderGeometry(CONN_R, CONN_R, CELL, 12);
    const connMeshes = Array.from({ length: POOL_SIZE }, () => {
      const m = new THREE.Mesh(connGeo, bodyMat);
      m.castShadow = true;
      m.visible    = false;
      scene.add(m);
      return m;
    });

    // ── Head mesh with cobra hood ─────────────────────────────────────────────
    const headGeo  = new THREE.SphereGeometry(HEAD_R, 22, 16);
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.castShadow = true;
    scene.add(headMesh);

    // Hood flare (flattened sphere behind head)
    const hoodGeo  = new THREE.SphereGeometry(HEAD_R * 1.3, 16, 12);
    const hoodMesh = new THREE.Mesh(hoodGeo, headMat);
    hoodMesh.scale.set(1.6, 0.3, 1.0);
    hoodMesh.position.set(0, -HEAD_R * 0.1, HEAD_R * 0.5);
    headMesh.add(hoodMesh);

    // Eyes (parented to head)
    const eyeGeo   = new THREE.SphereGeometry(2.2, 10, 7);
    const eyeMat   = new THREE.MeshPhongMaterial({ color: 0xd4b820, emissive: new THREE.Color(0x302000), shininess: 80 });
    const pupilGeo = new THREE.SphereGeometry(1.1, 8, 6);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x060606 });

    for (const s of [-1, 1]) {
      const eye   = new THREE.Mesh(eyeGeo, eyeMat);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      eye.position.set(s * HEAD_R * 0.55, HEAD_R * 0.30, -HEAD_R * 0.72);
      pupil.position.set(0, 0, eyeGeo.parameters.radius * 0.85);
      eye.add(pupil);
      headMesh.add(eye);
    }

    // Head-to-first-body connector (special, uses interpolated position)
    const headConnGeo  = new THREE.CylinderGeometry(CONN_R, CONN_R, CELL, 12);
    const headConnMesh = new THREE.Mesh(headConnGeo, bodyMat);
    headConnMesh.castShadow = true;
    headConnMesh.visible    = false;
    scene.add(headConnMesh);

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

      // ── Body segments + connectors ─────────────────────────────────────────
      for (const m of segMeshes) m.visible = false;
      for (const m of connMeshes) m.visible = false;
      headConnMesh.visible = false;

      for (let i = 1; i < snakeLen; i++) {
        const seg  = segPool[(headIdx + i) % POOL_SIZE];
        const mesh = segMeshes[(headIdx + i) % POOL_SIZE];
        const wp   = cellToWorld(seg.x, seg.y, BODY_Y);
        mesh.position.set(wp.x, wp.y, wp.z);
        mesh.visible = true;

        // Connector to previous segment
        if (i >= 2) {
          const prev = segPool[(headIdx + i - 1) % POOL_SIZE];
          const dx = prev.x - seg.x;
          const dz = prev.y - seg.y;
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && (dx !== 0 || dz !== 0)) {
            const conn = connMeshes[(headIdx + i) % POOL_SIZE];
            const midX = (seg.x + prev.x) / 2 * CELL - HALF + CELL / 2;
            const midZ = (seg.y + prev.y) / 2 * CELL - HALF + CELL / 2;
            conn.position.set(midX, BODY_Y, midZ);
            conn.rotation.set(
              dx !== 0 ? 0 : Math.PI / 2,
              0,
              dx !== 0 ? Math.PI / 2 : 0,
            );
            conn.visible = true;
          }
        }
      }

      // ── Head ──────────────────────────────────────────────────────────────
      const hwp = cellToWorld(hxF, hyF, HEAD_Y);
      headMesh.position.set(hwp.x, hwp.y, hwp.z);

      if (snakeLen > 1) {
        const neck = segPool[(headIdx + 1) % POOL_SIZE];
        const dx   = head.x - neck.x;
        const dz   = head.y - neck.y;
        const ndx  = Math.abs(dx) > 1 ? -Math.sign(dx) : dx;
        const ndz  = Math.abs(dz) > 1 ? -Math.sign(dz) : dz;
        if (ndx !== 0 || ndz !== 0) {
          headMesh.rotation.y = Math.atan2(ndx, ndz);
        }

        // Head-to-first-body connector
        const firstBody = segPool[(headIdx + 1) % POOL_SIZE];
        const bwp = cellToWorld(firstBody.x, firstBody.y, BODY_Y);
        const adx = hwp.x - bwp.x;
        const adz = hwp.z - bwp.z;
        if (Math.abs(adx) < CELL * 1.5 && Math.abs(adz) < CELL * 1.5) {
          headConnMesh.position.set(
            (hwp.x + bwp.x) / 2,
            BODY_Y,
            (hwp.z + bwp.z) / 2,
          );
          headConnMesh.rotation.set(
            Math.abs(adx) <= Math.abs(adz) ? Math.PI / 2 : 0,
            0,
            Math.abs(adx) > Math.abs(adz) ? Math.PI / 2 : 0,
          );
          headConnMesh.visible = true;
        }
      }

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
