/**
 * Board-themed obstacles: every themed board has a set, and every model stays
 * inside its cell and under OBSTACLE_H while it animates. Geometry only, no WebGL.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CELL, OBSTACLE_H } from '../constants';
import { BOARDS } from '../cosmetics/boards';
import { OBSTACLE_SETS, createObstacleLayer } from '../cosmetics/obstacles';

const cells = Array.from({ length: 24 }, (_, key) => ({ x: 0, z: 0, key }));   // every kind × turn

describe('obstacle sets', () => {
  it('covers every board except the level theme', () => {
    for (const b of BOARDS) expect(!!OBSTACLE_SETS[b.id], b.id).toBe(b.id !== 'level');
  });

  it('keeps the plain blocks for the level theme', () => {
    const layer = createObstacleLayer();
    layer.setCells(cells);
    layer.setBoard(null);
    expect(layer.active).toBe(false);
    expect(layer.group.children).toHaveLength(0);
  });

  for (const id of Object.keys(OBSTACLE_SETS)) {
    it(`${id}: one model and one footprint per cell, inside the cell and under OBSTACLE_H`, () => {
      const layer = createObstacleLayer();
      layer.setBoard(id);
      layer.setCells(cells);
      expect(layer.active).toBe(true);
      expect(layer.group.children).toHaveLength(cells.length);
      const box = new THREE.Box3();
      for (let t = 0; t < 6000; t += 250) {
        layer.update(t);
        layer.group.updateMatrixWorld(true);
        for (const holder of layer.group.children) {
          box.setFromObject(holder, true);
          expect(box.max.y, `${id} height at t=${t}`).toBeLessThanOrEqual(OBSTACLE_H + 0.5);
          expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z), `${id} width at t=${t}`).toBeLessThanOrEqual(CELL / 2 + 0.5);
        }
      }
      layer.dispose();
      expect(layer.group.children).toHaveLength(0);
    });
  }
});
