import { useEffect, useRef } from 'react';
import { COLS, ROWS, CELL, LEVELS } from '../constants';

const SIZE = COLS * CELL;

// Draw the static grid to an offscreen canvas once
let gridCache = null;
function getGridCanvas() {
  if (gridCache) return gridCache;
  const offscreen = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  offscreen.width  = SIZE * dpr;
  offscreen.height = SIZE * dpr;
  const ctx = offscreen.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let i = 0; i <= COLS; i++) {
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, SIZE);
  }
  for (let j = 0; j <= ROWS; j++) {
    ctx.moveTo(0, j * CELL);
    ctx.lineTo(SIZE, j * CELL);
  }
  ctx.stroke();
  gridCache = offscreen;
  return offscreen;
}

export function GameCanvas({ snake, food, levelIndex }) {
  const canvasRef = useRef(null);
  const color = LEVELS[levelIndex]?.color ?? '#4ecca3';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    // Set physical pixel size once (avoid layout thrash every frame)
    if (canvas.width !== SIZE * dpr || canvas.height !== SIZE * dpr) {
      canvas.width  = SIZE * dpr;
      canvas.height = SIZE * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Blit cached grid (background + grid lines)
    ctx.drawImage(getGridCanvas(), 0, 0, SIZE, SIZE);

    // Food
    const fx = food.x * CELL + CELL / 2;
    const fy = food.y * CELL + CELL / 2;
    ctx.fillStyle = '#ff4757';
    ctx.shadowColor = '#ff4757';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(fx, fy, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Snake — batch by transparency to minimise state changes
    snake.forEach((seg, i) => {
      const alpha = i === 0 ? 1 : Math.max(0.3, 1 - (i / snake.length) * 0.7);
      const hex = Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.fillStyle = i === 0 ? color : `${color}${hex}`;
      ctx.shadowColor = i === 0 ? color : 'transparent';
      ctx.shadowBlur  = i === 0 ? 10 : 0;
      const pad = i === 0 ? 1 : 2;
      ctx.beginPath();
      ctx.roundRect(
        seg.x * CELL + pad, seg.y * CELL + pad,
        CELL - pad * 2, CELL - pad * 2,
        i === 0 ? 4 : 3
      );
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  }, [snake, food, color]);

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
        border: `2px solid ${color}33`,
      }}
    />
  );
}
