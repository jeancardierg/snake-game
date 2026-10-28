/**
 * Camera views (Customize → View): framing maths and the rig, without WebGL.
 * A stand-in camera records what the rig sets.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  VIEWS, DEFAULT_VIEW, DEFAULT_3D_VIEW, LAST_3D_KEY, findView, turnSteering,
  basis, project, boardPoints, createCameraRig, loadLast3dView, saveLast3dView,
} from '../cameraViews';

const HALF = 130;
const D2R = Math.PI / 180;
const fakeCamera = () => ({
  position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  up: { set() {} },
  lookAt(x, y, z) { this.target = [x, y, z]; },
  updateProjectionMatrix() {},
});
const head = { x: 0, z: 0, ang: 0 };

/** Largest |screen coordinate| of the board's corners (ground and block tops) for view `id`. */
function cornerReach(id, aspect = 1) {
  const rig = createCameraRig(HALF);
  rig.setView(id, 0, false);
  rig.update(16, head);
  const p = rig.pose(id, aspect), tanH = Math.tan((p.fov * D2R) / 2);
  let max = 0;
  for (const pt of boardPoints(HALF).square) {
    const q = project(p.B, p.pos, tanH, pt, aspect);
    expect(q, `${id}: corner behind camera`).not.toBeNull();
    max = Math.max(max, Math.abs(q[0]), Math.abs(q[1]));
  }
  return max;
}

describe('camera views', () => {
  it('offers the five views with unique ids, Top-down first and default', () => {
    expect(VIEWS.map((v) => v.id)).toEqual(['top', 'tilt', 'iso', 'chase', 'orbit']);
    expect(DEFAULT_VIEW).toBe('top');
    expect(findView('nope').id).toBe('top');
  });

  it('only the chase camera turns steering into turn left / right', () => {
    expect(VIEWS.filter((v) => turnSteering(v.id)).map((v) => v.id)).toEqual(['chase']);
  });

  it('views that frame the board keep every corner on screen', () => {
    for (const v of VIEWS.filter((x) => x.follow === 0)) {
      expect(cornerReach(v.id), v.id).toBeLessThanOrEqual(1);
      expect(cornerReach(v.id, 16 / 9), `${v.id} wide`).toBeLessThanOrEqual(1);
    }
  });

  it('Top-down fits the board edge to edge, like the orthographic game camera', () => {
    expect(cornerReach('top')).toBeGreaterThan(0.99);
  });

  it('camera basis is orthonormal and looks down', () => {
    for (const v of VIEWS) {
      const B = basis(v.pitch, v.yaw * D2R);
      const len = (a) => Math.hypot(...a);
      expect(len(B.f)).toBeCloseTo(1); expect(len(B.r)).toBeCloseTo(1); expect(len(B.u)).toBeCloseTo(1);
      expect(B.f[1]).toBeLessThan(0);
    }
  });
});

describe('camera rig', () => {
  it('leaves the orthographic camera in charge for Top-down, takes over for 3D', () => {
    const rig = createCameraRig(HALF, 600);
    const cam = fakeCamera();
    rig.update(16, head);
    expect(rig.place(cam, 1, 0)).toBe(false);
    rig.setView('tilt', 0, false);
    expect(rig.place(cam, 1, 0)).toBe(true);
    expect(cam.fov).toBeCloseTo(30);
  });

  it('eases between views and ends on the target view', () => {
    const rig = createCameraRig(HALF, 600);
    const cam = fakeCamera();
    rig.update(16, head);
    rig.setView('tilt', 0, true);
    rig.place(cam, 1, 300);
    expect(cam.fov).toBeGreaterThan(1);
    expect(cam.fov).toBeLessThan(30);
    rig.setView('top', 1000, true);
    expect(rig.place(cam, 1, 1300)).toBe(true);       // still easing back
    expect(rig.place(cam, 1, 1700)).toBe(false);      // done: orthographic again
  });

  it('chase cam sits behind the head and follows a wrap across the edge', () => {
    const rig = createCameraRig(HALF);
    const cam = fakeCamera();
    rig.setView('chase', 0, false);
    rig.update(16, { x: 0, z: 0, ang: 0 });          // heading north (−Z)
    rig.place(cam, 1, 0);
    expect(cam.position.z).toBeGreaterThan(cam.target[2]);
    // Head leaves the east edge and re-enters on the west: the camera jumps with it.
    rig.update(1e5, { x: HALF - 5, z: 0, ang: -Math.PI / 2 });
    rig.update(16, { x: -HALF + 5, z: 0, ang: -Math.PI / 2 });
    rig.place(cam, 1, 0);
    expect(cam.target[0]).toBeLessThan(0);
  });
});

describe('last 3D view', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the tilted board and remembers 3D picks only', () => {
    expect(loadLast3dView()).toBe(DEFAULT_3D_VIEW);
    saveLast3dView('iso');
    saveLast3dView('top');
    expect(loadLast3dView()).toBe('iso');
    localStorage.setItem(LAST_3D_KEY, 'bogus');
    expect(loadLast3dView()).toBe(DEFAULT_3D_VIEW);
  });
});
