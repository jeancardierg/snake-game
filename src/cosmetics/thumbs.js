/**
 * thumbs.js — menu images for the wardrobe, made once and cached.
 *
 * Skin swatches and board thumbnails are 2D canvases. Hat, tail and food thumbnails
 * are rendered with a short-lived offscreen WebGL renderer the first time the
 * menu opens. Every function returns null where the browser (or jsdom) can't
 * draw, and the menu falls back to a plain tile.
 */
import * as THREE from 'three';
import { paintSkin } from './skins';
import { HATS, TAILS } from './accessories';
import { paintBoardThumb } from './boards';
import { FOODS } from './foods';

const skinUrls = new Map();
export function skinSwatch(skin) {
  if (!skinUrls.has(skin.id)) {
    let url;
    try { url = paintSkin(skin)?.map.toDataURL() ?? null; } catch { url = null; }
    skinUrls.set(skin.id, url);
  }
  return skinUrls.get(skin.id);
}

export function boardThumb(board, level) {
  try { return paintBoardThumb(board, level)?.toDataURL() ?? null; } catch { return null; }
}

let accessoryUrls = null;
/** { 'hat:witch': dataURL, 'tail:bow': dataURL, 'food:egg': dataURL, … } — empty object if WebGL is unavailable. */
export function accessoryThumbs() {
  if (accessoryUrls) return accessoryUrls;
  accessoryUrls = {};
  let r;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return accessoryUrls;
  }
  r.setSize(160, 110, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-2, 5, -3);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 160 / 110, 0.1, 500);
  const box = new THREE.Box3(), c = new THREE.Vector3(), view = new THREE.Vector3(0.75, 0.55, -1).normalize();
  for (const [slot, list] of [['hat', HATS], ['tail', TAILS], ['food', FOODS]]) {
    for (const item of list) {
      if (item.id === 'none') continue;
      const g = item.build();
      scene.add(g);
      box.setFromObject(g).getCenter(c);
      cam.position.copy(c).addScaledVector(view, box.getSize(new THREE.Vector3()).length() * 1.75);
      cam.lookAt(c);
      r.render(scene, cam);
      accessoryUrls[`${slot}:${item.id}`] = r.domElement.toDataURL();
      scene.remove(g);
      g.traverse((o) => { o.geometry?.dispose(); for (const m of [o.material].flat()) { m?.map?.dispose(); m?.dispose(); } });
    }
  }
  r.dispose();
  r.forceContextLoss();
  return accessoryUrls;
}
