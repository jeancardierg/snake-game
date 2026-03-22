/**
 * App — root component.
 *
 * Calls useSnake() and distributes the returned values to child components.
 * This is intentionally thin — all logic lives in the hook, all rendering
 * is delegated to the leaf components.
 *
 * Layout (top → bottom):
 *   <Scoreboard>   score | level badge | best
 *   <LevelBar>     progress bar to next level
 *   <canvas-wrap>
 *     <GameCanvas> the game board
 *     <Overlay>    idle / paused / dead screens (absolute, over the canvas)
 *   controls-hint  keyboard shortcuts + Pause and Reset buttons
 *
 * Touch controls: swipe on the canvas in any direction.
 * touchAction:'none' prevents the browser from scrolling while swiping.
 */
import { useRef, useCallback } from 'react';
import { useSnake } from './hooks/useSnake';
import { GameCanvas } from './components/GameCanvas';
import { Scoreboard } from './components/Scoreboard';
import { LevelBar } from './components/LevelBar';
import { Overlay } from './components/Overlay';
import { DIR } from './constants';
import './index.css';

// Minimum pixel travel required for a touch move to count as a directional swipe.
// Too low → accidental swipes on taps; too high → feels sluggish.
const SWIPE_THRESHOLD = 20;

export default function App() {
  // All game state and actions come from a single hook
  const { headIdxRef, snakeLenRef, foodRef, score, best, levelIndex, state, applyDir, pause, reset } = useSnake();

  // ── Swipe gesture detection ─────────────────────────────────────────────────
  // Track where each touch started. Using a ref so the handlers are stable
  // references and don't trigger unnecessary re-renders.
  const swipeStart = useRef(null);

  const handleSwipeStart = useCallback((e) => {
    if (!e.touches.length) return;  // touchstart always has ≥1 touch, but guard defensively
    // Record only the first touch point (identifier 0 in multi-touch scenarios)
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleSwipeEnd = useCallback((e) => {
    if (!swipeStart.current || !e.changedTouches.length) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    swipeStart.current = null;

    // Ignore micro-movements — must travel at least SWIPE_THRESHOLD px
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

    // The dominant axis determines direction
    if (Math.abs(dx) >= Math.abs(dy)) {
      applyDir(dx > 0 ? DIR.RIGHT : DIR.LEFT);
    } else {
      applyDir(dy > 0 ? DIR.DOWN : DIR.UP);
    }
  }, [applyDir]);

  return (
    <div className="app">
      {/* Top bar: score + level badge + best */}
      <Scoreboard score={score} best={best} levelIndex={levelIndex} />

      {/* Progress bar toward next speed level */}
      <LevelBar score={score} levelIndex={levelIndex} />

      {/* Game board — canvas + overlay stacked via position:absolute.
          Swipe handlers live here so the full board area responds to gestures.
          touchAction:'none' tells the browser not to scroll or zoom while the
          player's finger is on the canvas. */}
      <div
        className="canvas-wrap"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
        style={{ touchAction: 'none' }}
      >
        <GameCanvas headIdxRef={headIdxRef} snakeLenRef={snakeLenRef} foodRef={foodRef} levelIndex={levelIndex} />
        <Overlay
          state={state}
          score={score}
          levelIndex={levelIndex}
          onReset={reset}
          onPause={pause}
        />
      </div>

      {/* Keyboard hint + quick-action buttons */}
      <div className="controls-hint">
        <span>WASD / Arrows / Swipe</span>
        <button className="ctrl-btn" onClick={pause}>
          {state === 'paused' ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button className="ctrl-btn" onClick={reset}>↺ Reset</button>
      </div>
    </div>
  );
}
