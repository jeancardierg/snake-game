/**
 * WardrobePreview — the live 3D snake at the top of the Customize menu.
 * Owns one small WebGL scene (cosmetics/preview.js) for as long as the menu is
 * open. Without WebGL (old devices, jsdom) it renders an empty frame.
 */
import { useEffect, useRef } from 'react';
import { getLevel } from '../levels';
import { createPreview } from '../cosmetics/preview';

export function WardrobePreview({ loadout, levelIndex, view = null }) {
  const canvasRef  = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => {
    try {
      previewRef.current = createPreview(canvasRef.current);
    } catch {
      previewRef.current = null;   // no WebGL: the tiles still work
    }
    return () => { previewRef.current?.dispose(); previewRef.current = null; };
  }, []);

  useEffect(() => {
    previewRef.current?.setLoadout(loadout, getLevel(Math.max(levelIndex ?? 0, 0)).theme);
  }, [loadout, levelIndex]);

  // On the View tab the preview films the board with the picked camera.
  useEffect(() => {
    previewRef.current?.setView(view);
  }, [view]);

  return (
    <div className="ward-preview">
      <canvas ref={canvasRef} role="img" aria-label="Preview of your snake with the selected look" />
    </div>
  );
}
