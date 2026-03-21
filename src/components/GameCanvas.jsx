import { useEffect, useRef } from 'react';
import { COLS, ROWS, CELL, LEVELS } from '../constants';

export function GameCanvas({ snake, food, levelIndex }) {
  const canvasRef = useRef(null);
  const SIZE = COLS * CELL;
  const color = LEVELS[levelIndex]?.color ?? '#4ecca3';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= COLS; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); ctx.stroke();
    }
    for (let j = 0; j <= ROWS; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(SIZE, j * CELL); ctx.stroke();
    }

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

    // Snake
    snake.forEach((seg, i) => {
      const alpha = i === 0 ? 1 : Math.max(0.3, 1 - i / snake.length * 0.7);
      ctx.fillStyle = i === 0 ? color : color + Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.shadowColor = i === 0 ? color : 'transparent';
      ctx.shadowBlur = i === 0 ? 10 : 0;
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
  }, [snake, food, levelIndex, color, SIZE]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{ display: 'block', borderRadius: '8px', border: `2px solid ${color}33` }}
    />
  );
}
