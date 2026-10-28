/**
 * cameraViews.js — the camera views the player can pick (Customize → View).
 *
 * Every view is one perspective camera described by a few numbers; a 1° field
 * of view is visually flat, so Top-down and Isometric need no second camera
 * model. The distance is solved so zoom 1 fits the whole board, which also
 * makes a switch between two views a smooth dolly-zoom.
 *
 * Values come from Snake Camera Lab (the prototype), tuned against similar
 * games: a high tilt keeps far rows readable on phones, the chase camera sits
 * high and looks ahead (low chase cameras read as dizzying and show obstacles
 * late), the orbit is slow, and every view eases instead of snapping.
 *
 * createCameraRig(half) → { setView, update, place } drives a THREE camera
 * for a board of half-size `half`; GameCanvas and the menu preview share it.
 * Pure apart from the camera it is handed, so it is unit-tested without WebGL.
 */
import { CELL, OBSTACLE_H } from './constants';

const D2R = Math.PI / 180;
const OB_H = CELL * 0.7;               // wall block height (menu thumbnails)
const FIT_H = Math.max(OB_H, OBSTACLE_H); // tallest obstacle: its top must stay in frame too

// pitch: degrees above the ground (90 = straight down). yaw: degrees, 0 looks
// north (up the screen). fov: vertical field of view in degrees. zoom: 1 fits
// the board. follow: 0 frames the board, 1 frames the head. ahead: cells of
// look-ahead along the heading. lag: easing time constant in ms. orbit: °/s.
// rotate: the camera turns with the snake (steering becomes turn left/right).
export const VIEWS = [
  { id: 'top',   name: 'Top-down',     tag: 'CLASSIC',   desc: 'Flat, straight down: the classic view.',
    pitch: 90, yaw: 0,  fov: 1,  zoom: 1,   follow: 0, ahead: 0, lag: 0,   orbit: 0, rotate: false },
  { id: 'tilt',  name: 'Tilted board', desc: 'The board tips away from you. Arrows and swipes still match the screen.',
    pitch: 62, yaw: 0,  fov: 30, zoom: 1,   follow: 0, ahead: 0, lag: 250, orbit: 0, rotate: false },
  { id: 'iso',   name: 'Isometric',    desc: 'A flat diamond view. Arrows move along the board, which is turned 45°.',
    pitch: 35, yaw: 45, fov: 1,  zoom: 1,   follow: 0, ahead: 0, lag: 250, orbit: 0, rotate: false },
  { id: 'chase', name: 'Chase cam',    tag: 'TURN KEYS', desc: 'Rides behind the head. ◀ ▶, A / D and side swipes turn the snake left or right.',
    pitch: 40, yaw: 0,  fov: 55, zoom: 1.8, follow: 1, ahead: 3, lag: 250, orbit: 0, rotate: true },
  { id: 'orbit', name: 'Low orbit',    desc: 'A low view that slowly circles the board (one lap every 90 s).',
    pitch: 38, yaw: 0,  fov: 30, zoom: 1.1, follow: 0, ahead: 0, lag: 250, orbit: 4, rotate: false },
];

export const DEFAULT_VIEW    = 'top';
export const DEFAULT_3D_VIEW = 'tilt';
export const TRANSITION_MS   = 600;
export const LAST_3D_KEY     = 'snake-view3d';

/** View `id`, or Top-down for an unknown id. */
export function findView(id) {
  return VIEWS.find((v) => v.id === id) ?? VIEWS[0];
}

/** True when the view turns with the snake, so steering is relative to the head. */
export function turnSteering(id) {
  return findView(id).rotate;
}

/** The 3D view the 2D/3D button switches to. Never throws. */
export function loadLast3dView() {
  try {
    const id = localStorage.getItem(LAST_3D_KEY);
    return id && id !== DEFAULT_VIEW && VIEWS.some((v) => v.id === id) ? id : DEFAULT_3D_VIEW;
  } catch {
    return DEFAULT_3D_VIEW;
  }
}
export function saveLast3dView(id) {
  if (id === DEFAULT_VIEW || !VIEWS.some((v) => v.id === id)) return;
  try { localStorage.setItem(LAST_3D_KEY, id); } catch { /* storage unavailable */ }
}

// ─── Projection maths ─────────────────────────────────────────────────────────
const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Camera axes for a pitch (deg) and yaw (rad): dir = target → camera, f forward, r right, u up. */
export function basis(pitch, yaw) {
  const p = Math.min(pitch, 89.9) * D2R;   // exactly 90 would leave no "up" for lookAt
  const dir = [Math.cos(p) * Math.sin(yaw), Math.sin(p), Math.cos(p) * Math.cos(yaw)];
  const f = [-dir[0], -dir[1], -dir[2]];
  const rl = Math.hypot(f[2], f[0]) || 1;
  const r = [-f[2] / rl, 0, f[0] / rl];                    // f × (0, 1, 0)
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { dir, f, r, u };
}

/** Normalised screen position [x, y, depth] of world point `pt`, or null behind the camera. */
export function project(B, pos, tanH, pt, aspect = 1) {
  const rel = [pt[0] - pos[0], pt[1] - pos[1], pt[2] - pos[2]], z = dot(rel, B.f);
  return z <= 0.01 ? null : [dot(rel, B.r) / (z * tanH * aspect), dot(rel, B.u) / (z * tanH), z];
}

/** Ground corners and obstacle-top corners of the board; the circle variant fits any yaw. */
export function boardPoints(half) {
  const square = [], circle = [];
  for (const y of [0, FIT_H]) {
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) square.push([x * half, y, z * half]);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      circle.push([Math.cos(a) * half * Math.SQRT2, y, Math.sin(a) * half * Math.SQRT2]);
    }
  }
  return { square, circle };
}

/** Distance from the board centre at which every point in `pts` fits inside `margin` of the frame. */
export function fitDistance(pitch, yaw, fov, pts, aspect = 1, margin = 0.96) {
  const B = basis(pitch, yaw), tanH = Math.tan((fov * D2R) / 2);
  const fits = (d) => {
    const pos = [B.dir[0] * d, B.dir[1] * d, B.dir[2] * d];
    for (const pt of pts) {
      const q = project(B, pos, tanH, pt, aspect);
      if (!q || Math.abs(q[0]) > margin || Math.abs(q[1]) > margin) return false;
    }
    return true;
  };
  let lo = Math.log(10), hi = Math.log(5e6);
  for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (fits(Math.exp(m))) hi = m; else lo = m; }
  return Math.exp(hi);
}

// ─── Rig ──────────────────────────────────────────────────────────────────────
/**
 * Camera state for every view on a board of half-size `half`. Each view keeps
 * its own eased target, heading and orbit angle, updated every frame, so a
 * switch never starts from a stale position.
 */
export function createCameraRig(half, transitionMs = TRANSITION_MS) {
  const pts = boardPoints(half);
  const live = Object.fromEntries(VIEWS.map((v) => [v.id, { tx: 0, tz: 0, hy: 0, orb: 0, init: false }]));
  let current = DEFAULT_VIEW;
  let trans = null;

  /** Switch view; eases from the current camera unless `animate` is false. */
  function setView(id, now, animate = true) {
    const next = findView(id).id;
    if (next === current) return;
    trans = animate && transitionMs > 0 ? { from: current, to: next, t0: now } : null;
    current = next;
  }

  /** Advance every view by `dt` ms. head: { x, z, ang } in world units; ang as head.rotation.y. */
  function update(dt, head) {
    const fx = -Math.sin(head.ang), fz = -Math.cos(head.ang);   // head forward
    for (const v of VIEWS) {
      const L = live[v.id];
      const dx = (head.x + fx * v.ahead * CELL) * v.follow;
      const dz = (head.z + fz * v.ahead * CELL) * v.follow;
      if (!L.init) { L.tx = dx; L.tz = dz; L.hy = head.ang; L.init = true; }
      // Wrap mode: the head re-enters on the far side; jump with it instead of sweeping across.
      if (Math.abs(dx - L.tx) > half) L.tx += 2 * half * Math.sign(dx - L.tx);
      if (Math.abs(dz - L.tz) > half) L.tz += 2 * half * Math.sign(dz - L.tz);
      const k = v.lag > 0 ? 1 - Math.exp(-dt / v.lag) : 1;
      L.tx += (dx - L.tx) * k;
      L.tz += (dz - L.tz) * k;
      L.hy += wrapAng(head.ang - L.hy) * k;
      L.orb = wrapAng(L.orb + (v.orbit * D2R * dt) / 1000);
    }
  }

  function vec(id) {
    const v = findView(id), L = live[id];
    return { pitch: v.pitch, yaw: v.yaw * D2R + (v.rotate ? L.hy : 0) + L.orb, lfov: Math.log(v.fov), zoom: v.zoom,
      tx: L.tx, tz: L.tz, circ: v.rotate || v.orbit > 0 ? 1 : 0 };
  }

  /** Camera pose for blended view parameters `p`: { B, pos, target, fov, near, far }. */
  function pose(p, aspect) {
    const fov = Math.exp(p.lfov);
    // Top-down fits the board edge to edge (as the orthographic game camera does); tilted views keep a little air.
    const margin = 1 - 0.04 * Math.min(1, (90 - p.pitch) / 10);
    const fit = (list) => fitDistance(p.pitch, p.yaw, fov, list, aspect, margin);
    const fd = p.circ <= 0 ? fit(pts.square) : p.circ >= 1 ? fit(pts.circle)
      : Math.exp(Math.log(fit(pts.square)) * (1 - p.circ) + Math.log(fit(pts.circle)) * p.circ);
    const d = fd / p.zoom, B = basis(p.pitch, p.yaw);
    return { B, pos: [p.tx + B.dir[0] * d, B.dir[1] * d, p.tz + B.dir[2] * d], target: [p.tx, 0, p.tz], fov,
      near: Math.max(0.5, d * 0.04), far: d + half * 16 };
  }

  /**
   * Point `camera` (a THREE.PerspectiveCamera) at the current view. Returns
   * false — camera untouched — when the view is plain Top-down and no switch
   * is running, so the caller can keep its exact orthographic camera; pass
   * force to always get the perspective camera.
   */
  function place(camera, aspect, now, force = false) {
    let p = vec(current);
    if (trans) {
      const t = (now - trans.t0) / transitionMs;
      if (t >= 1) trans = null;
      else {
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const a = vec(trans.from), b = p, l = (x, y) => x + (y - x) * e;
        p = { pitch: l(a.pitch, b.pitch), yaw: a.yaw + wrapAng(b.yaw - a.yaw) * e, lfov: l(a.lfov, b.lfov),
          zoom: l(a.zoom, b.zoom), tx: l(a.tx, b.tx), tz: l(a.tz, b.tz), circ: l(a.circ, b.circ) };
      }
    }
    if (!trans && current === DEFAULT_VIEW && !force) return false;
    const c = pose(p, aspect);
    camera.fov = c.fov;
    camera.aspect = aspect;
    camera.near = c.near;
    camera.far = c.far;
    camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.target[0], c.target[1], c.target[2]);
    camera.updateProjectionMatrix();
    return true;
  }

  return { setView, update, place, pose: (id, aspect = 1) => pose(vec(id), aspect), get view() { return current; } };
}

/**
 * Small 2D sketch of the board seen from view `v` (a menu thumbnail): ground,
 * grid, a few blocks and a snake heading north from the centre. Returns null
 * where 2D canvas is unavailable.
 */
export function paintViewThumb(v, w = 150, h = 90) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (!x) return null;
  const half = 130, aspect = w / h;
  const rig = createCameraRig(half, 0);
  rig.setView(v.id, 0, false);
  rig.update(1e6, { x: 30, z: -20, ang: -Math.PI / 2 });   // the sketched head, heading east
  const p = rig.pose(v.id, aspect), B = p.B, tanH = Math.tan((p.fov * D2R) / 2);
  const toPx = (pt) => { const q = project(B, p.pos, tanH, pt, aspect); return q && [(q[0] + 1) * w / 2, (1 - q[1]) * h / 2]; };
  const poly = (list, fill, stroke) => {
    const s = list.map(toPx);
    if (s.some((q) => !q)) return;
    x.beginPath(); s.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath();
    if (fill) { x.fillStyle = fill; x.fill(); }
    if (stroke) { x.strokeStyle = stroke; x.stroke(); }
  };
  x.fillStyle = '#2f5e22'; x.fillRect(0, 0, w, h);
  poly([[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]], '#4a9d3f');
  x.lineWidth = 0.6;
  for (let i = 0; i <= 13; i++) {
    const k = -half + i * CELL;
    for (const seg of [[[k, 0, -half], [k, 0, half]], [[-half, 0, k], [half, 0, k]]]) {
      const a = toPx(seg[0]), b = toPx(seg[1]);
      if (a && b) { x.strokeStyle = 'rgba(30,70,20,.45)'; x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.stroke(); }
    }
  }
  for (const [gx, gz] of [[-70, -70], [70, -70], [-70, 70], [70, 70], [0, -110]]) {
    const s = CELL * 0.45;
    poly([[gx - s, OB_H, gz - s], [gx + s, OB_H, gz - s], [gx + s, OB_H, gz + s], [gx - s, OB_H, gz + s]], '#7a5c33', '#3d2a14');
  }
  const snake = [[0, 6, 40], [0, 6, 0], [0, 6, -20], [30, 6, -20]].map(toPx);
  if (snake.every(Boolean)) {
    x.lineCap = x.lineJoin = 'round';
    x.strokeStyle = '#b01818'; x.lineWidth = Math.max(2, h / 22);
    x.beginPath(); snake.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke();
    x.fillStyle = '#141414'; x.beginPath(); x.arc(...snake[3], x.lineWidth * 0.9, 0, Math.PI * 2); x.fill();
  }
  return c;
}
