/**
 * preview.js — the live snake preview at the top of the Customize menu.
 *
 * A small, self-contained three.js scene: a 7×7 board where a snake runs a
 * fixed loop at constant speed (the same path-following idea as the game:
 * every body point samples one trail on the ground). It wears the loadout
 * being edited, so the menu shows each pick whatever the game state is
 * (idle, paused or game over) and wherever the real snake happens to be.
 *
 * createPreview(canvas) → { setLoadout(loadout, levelTheme), setView(id | null), dispose() }
 * setView(id) films the board with that camera view (Customize → View);
 * null returns to the menu's own showcase angle.
 */
import * as THREE from 'three';
import { CELL } from '../constants';
import { BODY_R, HEAD_R, HEAD_Y, HEAD_SCALE } from '../snakeProfile';
import { SKINS, paintSkin } from './skins';
import { BOARDS, FX, paintGround } from './boards';
import { HATS, TAILS } from './accessories';
import { FOODS, foodMarker } from './foods';
import { createCameraRig } from '../cameraViews';
import { createObstacleLayer } from './obstacles';

const N = 7, HALF = N * CELL / 2;
const BODY_LEN = CELL * 5.5;
const SPEED    = CELL * 3.2;                  // ≈ a 310 ms tick
const NECK_R   = BODY_R * 0.62, NECK_LEN = CELL * 1.1;
const NR = 110, RAD = 14;                    // rings × radial segments
const LOOP = [[-2, -2], [2, -2], [2, 0], [0, 0], [0, 2], [-2, 2]];
const WALLS = [[2, 2], [-3, 0], [3, -3]];
const FOOD_CELL = [1, 1];                    // inside the loop, beside the snake's path

const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const find = (list, id) => list.find((i) => i.id === id);

/** Closed trail through LOOP with filleted corners and a ground-pinned wave, resampled every 0.5 units. */
function buildTrail() {
  const P = LOOP.map(([x, z]) => [x * CELL, z * CELL]), raw = [], r = CELL / 2, n = P.length;
  for (let i = 0; i < n; i++) {
    const p = P[(i - 1 + n) % n], c = P[i], q = P[(i + 1) % n];
    const li = Math.hypot(c[0] - p[0], c[1] - p[1]), lo = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const a = [c[0] - (c[0] - p[0]) / li * r, c[1] - (c[1] - p[1]) / li * r];
    const b = [c[0] + (q[0] - c[0]) / lo * r, c[1] + (q[1] - c[1]) / lo * r];
    for (let k = 0; k <= 10; k++) { const t = k / 10, u = 1 - t; raw.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); }
  }
  raw.push(raw[0]);
  const resample = (pts, step) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1], out = [];
    for (let s = 0, j = 0; s < L; s += step) {
      while (cum[j + 1] < s) j++;
      const t = (s - cum[j]) / (cum[j + 1] - cum[j]);
      out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
    }
    return { out, L };
  };
  const base = resample(raw, 1), m = base.out.length;
  const waves = Math.round(base.L / (CELL * 2.4)), A = CELL * 0.1;
  const wavy = base.out.map(([x, z], i) => {
    const pa = base.out[(i - 2 + m) % m], pb = base.out[(i + 2) % m];
    const tx = pb[0] - pa[0], tz = pb[1] - pa[1], l = Math.hypot(tx, tz) || 1;
    const off = A * Math.sin(i / m * Math.PI * 2 * waves);
    return [x - tz / l * off, z + tx / l * off];
  });
  wavy.push(wavy[0]);
  return resample(wavy, 0.5);
}

export function createPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);
  const cam = new THREE.PerspectiveCamera(34, 2, 1, 2000);
  cam.position.set(60, 230, 190);
  cam.lookAt(0, 0, 8);

  const ambient = new THREE.AmbientLight(0xffffff, 1.1);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-90, 200, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 500 });
  sun.shadow.bias = -0.001;
  scene.add(ambient, sun);

  // Board
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(N * CELL, N * CELL), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const gridMat = new THREE.LineBasicMaterial({ transparent: true });
  {
    const v = [];
    for (let i = 0; i <= N; i++) { const k = -HALF + i * CELL; v.push(-HALF, 0.3, k, HALF, 0.3, k, k, 0.3, -HALF, k, 0.3, HALF); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    scene.add(new THREE.LineSegments(g, gridMat));
  }
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const wallGeo = new THREE.BoxGeometry(CELL * 0.9, CELL * 0.7, CELL * 0.9);
  const wallMeshes = WALLS.map(([x, z]) => {
    const w = new THREE.Mesh(wallGeo, wallMat);
    w.position.set(x * CELL, CELL * 0.35, z * CELL);
    w.castShadow = w.receiveShadow = true;
    scene.add(w);
    return w;
  });
  const themedWalls = createObstacleLayer();
  themedWalls.setCells(WALLS.map(([x, z]) => ({ x: x * CELL, z: z * CELL, key: (x + 3) * N + (z + 3) })));
  scene.add(themedWalls.group);

  // Body tube (rebuilt in place each frame)
  const trail = buildTrail();
  const at = (s, o) => {
    const { out: pts, L } = trail, n = pts.length;
    s = ((s % L) + L) % L;
    const f = s / L * n, i = Math.floor(f) % n, t = f - Math.floor(f), a = pts[i], b = pts[(i + 1) % n];
    o.x = a[0] + (b[0] - a[0]) * t; o.z = a[1] + (b[1] - a[1]) * t;
    const p = pts[(i - 3 + n) % n], q = pts[(i + 4) % n], tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
    o.tx = tx / l; o.tz = tz / l;
    return o;
  };
  const radiusAt = (d) => {
    const t = d / BODY_LEN, b = BODY_R * (t < 0.55 ? 1 : 1 - smooth((t - 0.55) / 0.45) * 0.9);
    return NECK_R + (b - NECK_R) * smooth(d / NECK_LEN);
  };
  const pos = new Float32Array(NR * (RAD + 1) * 3), nor = new Float32Array(pos.length), uv = new Float32Array(NR * (RAD + 1) * 2), idx = [];
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < RAD; j++) {
    const a = i * (RAD + 1) + j, b = a + 1, c = a + RAD + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bodyGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  bodyGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  bodyGeo.setIndex(idx);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  body.frustumCulled = false;
  scene.add(body);

  // Head, eyes, sockets, tongue, hat mount
  const head = new THREE.Group();
  scene.add(head);
  const headGeo = new THREE.SphereGeometry(HEAD_R, 28, 20);
  headGeo.scale(HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z);
  const headMat = new THREE.MeshPhongMaterial();
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.castShadow = true;
  head.add(headMesh);
  const eyeMat = new THREE.MeshPhongMaterial({ shininess: 90 });
  const socketMat = new THREE.MeshPhongMaterial({ color: 0x000000, shininess: 10 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x060606 });
  const sockets = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 9), eyeMat);
    eye.position.set(s * HEAD_R * 0.5, HEAD_R * 0.28, -HEAD_R * 0.62);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(1.05, 8, 6), pupilMat);
    pupil.scale.set(0.4, 1, 0.6);
    pupil.position.set(s * 0.5, 0, -1.6);
    eye.add(pupil);
    const socket = new THREE.Mesh(new THREE.SphereGeometry(3.3, 12, 9), socketMat);
    socket.position.copy(eye.position).add(new THREE.Vector3(s * 0.3, 0.2, 0.7));
    sockets.push(socket);
    head.add(eye, socket);
  }
  const tongueMat = new THREE.MeshBasicMaterial({ color: 0xd11a2a });
  const tongue = new THREE.Group();
  {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 5, 6), tongueMat);
    b.rotation.x = Math.PI / 2; b.position.z = -2.5; tongue.add(b);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.12, 4, 5), tongueMat);
      p.rotation.x = Math.PI / 2; p.rotation.y = s * 0.35; p.position.set(s * 0.9, 0, -6); tongue.add(p);
    }
  }
  tongue.position.set(0, HEAD_R * 0.05, -HEAD_R * 1.15);
  head.add(tongue);
  const hatAnchor = new THREE.Group();
  hatAnchor.position.set(0, HEAD_R * HEAD_SCALE.y * 0.82, 1.6);
  head.add(hatAnchor);
  const tailAnchor = new THREE.Group(), follower = new THREE.Group();
  scene.add(tailAnchor, follower);
  const foodAnchor = new THREE.Group(), marker = foodMarker();
  marker.group.position.set(FOOD_CELL[0] * CELL, 0.7, FOOD_CELL[1] * CELL);
  scene.add(foodAnchor, marker.group);

  // Weather (board fx)
  const WX = 120, wxPos = new Float32Array(WX * 3), wxVel = new Float32Array(WX * 3), wxCol = new Float32Array(WX * 3);
  const wxGeo = new THREE.BufferGeometry();
  wxGeo.setAttribute('position', new THREE.BufferAttribute(wxPos, 3));
  wxGeo.setAttribute('color', new THREE.BufferAttribute(wxCol, 3));
  const wxMat = new THREE.PointsMaterial({ size: 3, vertexColors: true, transparent: true, depthWrite: false });
  const weather = new THREE.Points(wxGeo, wxMat);
  weather.frustumCulled = false;
  scene.add(weather);

  // ── Loadout ────────────────────────────────────────────────────────────────
  const textures = new Map();
  const tex = (key, make) => { if (!textures.has(key)) textures.set(key, make()); return textures.get(key); };
  const cur = { skin: null, skinItem: null, hat: null, tail: null, board: null, hatObj: null, tailObj: null, tailItem: null, food: null, foodObj: null, foodItem: null, foodPulse: [], fx: null };
  const disposeTree = (o) => o.traverse((m) => { m.geometry?.dispose(); for (const x of [m.material].flat()) { x?.map?.dispose(); x?.dispose(); } });

  function setLoadout(loadout, levelTheme) {
    if (loadout.skin !== cur.skin) {
      cur.skin = loadout.skin;
      const skin = find(SKINS, loadout.skin) ?? find(SKINS, 'coral');
      const t = tex(`skin:${skin.id}`, () => {
        const p = paintSkin(skin);
        const mk = (c) => { if (!c) return null; const x = new THREE.CanvasTexture(c); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; return x; };
        return { map: mk(p?.map), glow: mk(p?.glow), skin };
      });
      bodyMat.map = t.map; bodyMat.emissiveMap = t.glow;
      bodyMat.emissive.set(t.glow ? 0xffffff : 0x000000);
      bodyMat.specular.set(skin.head.spec); bodyMat.shininess = Math.min(skin.head.shin, 120);
      bodyMat.needsUpdate = true;
      headMat.color.set(skin.head.color); headMat.specular.set(skin.head.spec); headMat.shininess = skin.head.shin;
      eyeMat.color.set(skin.eye.color); eyeMat.emissive.set(skin.eye.glow);
      sockets.forEach((s) => (s.visible = !!skin.eye.socket));
      cur.skinItem = skin;
    }
    if (loadout.hat !== cur.hat) {
      cur.hat = loadout.hat;
      if (cur.hatObj) { hatAnchor.remove(cur.hatObj); disposeTree(cur.hatObj); cur.hatObj = null; }
      const h = find(HATS, loadout.hat);
      if (h && h.id !== 'none') { cur.hatObj = h.build(); hatAnchor.add(cur.hatObj); }
    }
    if (loadout.food !== cur.food) {
      cur.food = loadout.food;
      if (cur.foodObj) { foodAnchor.remove(cur.foodObj); disposeTree(cur.foodObj); }
      const f = find(FOODS, loadout.food) ?? find(FOODS, 'mine');
      cur.foodItem = f;
      cur.foodObj = f.build();
      cur.foodPulse = [];
      cur.foodObj.traverse((o) => { if (o.name === 'pulse' && o.material) cur.foodPulse.push(o); });
      foodAnchor.add(cur.foodObj);
      foodAnchor.position.set(FOOD_CELL[0] * CELL, f.y, FOOD_CELL[1] * CELL);
      marker.setColor(f.glow);
    }
    if (loadout.tail !== cur.tail) {
      cur.tail = loadout.tail;
      if (cur.tailObj) { cur.tailObj.removeFromParent(); disposeTree(cur.tailObj); cur.tailObj = null; }
      const t = find(TAILS, loadout.tail);
      cur.tailItem = t && t.id !== 'none' ? t : null;
      if (cur.tailItem) { cur.tailObj = t.build(); (t.follower ? follower : tailAnchor).add(cur.tailObj); }
    }
    const boardKey = `${loadout.board}:${levelTheme?.ground}`;
    if (boardKey !== cur.board) {
      cur.board = boardKey;
      const b = find(BOARDS, loadout.board);
      const custom = b && b.id !== 'level';
      const look = custom ? b : { bg: levelTheme.bg, ground: levelTheme.ground, grid: levelTheme.grid, gridOp: 0.3, obstacle: levelTheme.obstacle, ambient: 0xffffff, sun: 0xffffff };
      scene.background.set(look.bg);
      groundMat.map = custom ? tex(`ground:${b.id}`, () => { const c = paintGround(b, 256); if (!c) return null; const x = new THREE.CanvasTexture(c); x.colorSpace = THREE.SRGBColorSpace; return x; }) : null;
      groundMat.color.set(groundMat.map ? 0xffffff : look.ground);
      groundMat.needsUpdate = true;
      gridMat.color.set(look.grid); gridMat.opacity = look.gridOp;
      wallMat.color.set(look.obstacle); wallMat.emissive.set(look.obstacleGlow ?? 0x000000);
      themedWalls.setBoard(custom ? b.id : null);
      wallMeshes.forEach((m) => { m.visible = !themedWalls.active; });
      ambient.color.set(look.ambient); sun.color.set(look.sun);
      setFx(custom && b.fx ? FX[b.fx] : null);
    }
  }

  function setFx(fx) {
    cur.fx = fx;
    weather.visible = !!fx;
    if (!fx) return;
    let seed = 7;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    wxMat.blending = fx.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    wxMat.size = fx.size;
    wxMat.needsUpdate = true;
    const c = new THREE.Color();
    for (let i = 0; i < WX; i++) {
      c.set(fx.cols[i % fx.cols.length]);
      wxCol.set([c.r, c.g, c.b], i * 3);
      wxPos.set([(r() - 0.5) * N * CELL, r() * fx.area, (r() - 0.5) * N * CELL], i * 3);
      wxVel.set(fx.spawn(r), i * 3);
    }
    wxGeo.attributes.position.needsUpdate = wxGeo.attributes.color.needsUpdate = true;
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────
  const P = { x: 0, z: 0, tx: 0, tz: 1 };
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sHead = 0, last = performance.now(), clock = 0, raf = 0, stopped = false;
  let w = 0, h = 0;
  const rig = createCameraRig(HALF);
  let viewMode = false;

  function setView(id) {
    if (id) { rig.setView(id, performance.now(), viewMode); viewMode = true; }
    else if (viewMode) { viewMode = false; w = 0; }   // w = 0 restores the showcase camera next frame
  }

  function frame(now) {
    if (stopped) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw && ch && (cw !== w || ch !== h)) {
      cam.fov = 34; cam.near = 1; cam.far = 2000;
      w = cw; h = ch;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      // Pull back on narrow canvases so the whole board stays in frame.
      const fit = Math.max(1, 1.5 / cam.aspect);
      cam.position.set(60 * fit, 230 * fit, 190 * fit);
      cam.lookAt(0, 0, 8);
      cam.updateProjectionMatrix();
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; clock += dt;
    sHead += SPEED * dt * (reduce ? 0.5 : 1);
    const skin = cur.skinItem, ulen = (skin?.ulen ?? 2) * CELL;

    for (let i = 0; i < NR; i++) {
      const d = i / (NR - 1) * BODY_LEN;
      at(sHead - d, P);
      const r = radiusAt(d), sx = -P.tz, sz = P.tx;
      for (let j = 0; j <= RAD; j++) {
        const th = j / RAD * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), k = i * (RAD + 1) + j;
        const nx = sx * c, nz = sz * c;
        pos[k * 3] = P.x + nx * r; pos[k * 3 + 1] = r + s * r; pos[k * 3 + 2] = P.z + nz * r;
        nor[k * 3] = nx; nor[k * 3 + 1] = s; nor[k * 3 + 2] = nz;
        uv[k * 2] = d / ulen; uv[k * 2 + 1] = j / RAD;
      }
    }
    bodyGeo.attributes.position.needsUpdate = bodyGeo.attributes.normal.needsUpdate = bodyGeo.attributes.uv.needsUpdate = true;
    if (skin?.scroll && bodyMat.map) bodyMat.map.offset.x = (bodyMat.map.offset.x - dt * skin.scroll) % 1;
    bodyMat.emissiveIntensity = skin?.glowPulse ? 0.75 + 0.35 * Math.sin(clock * 3.2) : 1;
    if (themedWalls.active) themedWalls.update(now, !reduce);

    at(sHead, P);
    head.position.set(P.x, HEAD_Y, P.z);
    head.rotation.y = Math.atan2(-P.tx, -P.tz);
    const flick = (clock % 2.2) / 2.2;
    tongue.visible = flick < 0.18;
    const ring = cur.hatObj?.getObjectByName('halo-ring');
    if (ring) ring.position.y = 9 + Math.sin(clock * 2.4) * 0.9;

    const dT = BODY_LEN - 5;
    at(sHead - dT, P);
    tailAnchor.position.set(P.x, radiusAt(dT), P.z);
    tailAnchor.rotation.y = Math.atan2(-P.tx, -P.tz);
    const t = cur.tailItem, o = cur.tailObj, u = o?.userData ?? {};
    if (u.shake) o.rotation.y = Math.sin(clock * 48) * 0.16 * (Math.sin(clock * 0.9) > 0.2 ? 1 : 0.15);
    if (u.swing) u.swing.rotation.x = Math.sin(clock * 6) * 0.35;
    if (u.flicker) u.flicker.forEach((m, i) => { const f = 0.85 + Math.sin(clock * (17 + i * 5) + i) * 0.12; m.scale.set(f, f * (1 + i * 0.05), f); });
    if (u.spin) u.spin.rotation.y += dt * 3;
    if (u.boing) { const b = 1 + Math.sin(clock * 9) * 0.08; o.scale.set(b, 2 - b, b); }
    if (t?.follower) {
      at(sHead - BODY_LEN - (t.hop ? 16 : 22), P);
      follower.position.set(P.x, t.hop ? Math.abs(Math.sin(clock * 7)) * 4 : 13 + Math.sin(clock * 2.6) * 2.2, P.z);
      follower.rotation.y = Math.atan2(-P.tx, -P.tz);
    }

    if (cur.foodItem) {
      foodAnchor.rotation.y += cur.foodItem.spin ?? 0.012;
      const blink = (Math.sin(clock * 8) + 1) / 2;
      for (const m of cur.foodPulse) m.material.emissiveIntensity = 0.5 + blink;
      marker.update(clock);
    }

    const fx = cur.fx;
    if (fx) {
      for (let i = 0; i < WX; i++) {
        const k = i * 3;
        wxPos[k] += (wxVel[k] + Math.sin(clock * 1.3 + i) * fx.sway) * dt;
        wxPos[k + 1] += wxVel[k + 1] * dt;
        wxPos[k + 2] += (wxVel[k + 2] + Math.cos(clock * 1.1 + i * 1.7) * fx.sway) * dt;
        if (fx.rise ? wxPos[k + 1] > fx.area : wxPos[k + 1] < 0) wxPos[k + 1] = fx.rise ? 0 : fx.area;
        if (Math.abs(wxPos[k]) > HALF) wxPos[k] = -Math.sign(wxPos[k]) * HALF;
        if (Math.abs(wxPos[k + 2]) > HALF) wxPos[k + 2] = -Math.sign(wxPos[k + 2]) * HALF;
      }
      wxGeo.attributes.position.needsUpdate = true;
    }

    at(sHead, P);
    rig.update(dt * 1000, { x: P.x, z: P.z, ang: head.rotation.y });
    if (viewMode && h) rig.place(cam, w / h, now, true);

    renderer.render(scene, cam);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function dispose() {
    stopped = true;
    cancelAnimationFrame(raf);
    for (const t of textures.values()) { t?.map?.dispose?.(); t?.glow?.dispose?.(); t?.dispose?.(); }
    disposeTree(scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return { setLoadout, setView, dispose };
}
