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
 *   <board-slot>   flexible area; the board is the largest square that fits it
 *     <canvas-wrap>
 *       <GameCanvas> the game board
 *       <Overlay>    idle / paused (+ Customize) / dead screens (absolute, over the canvas)
 *   <DPad>         touch devices only
 *   controls-hint  keyboard shortcuts + Pause, Reset, Music and mode buttons
 *
 * Landscape phones switch to board-left / controls-right (see index.css).
 *
 * Touch controls: swipe on the canvas in any direction.
 * touchAction:'none' prevents the browser from scrolling while swiping.
 */
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useSnake } from './hooks/useSnake';
import { GameCanvas } from './components/GameCanvas';
import { Scoreboard } from './components/Scoreboard';
import { LevelBar } from './components/LevelBar';
import { Overlay } from './components/Overlay';
import { DPad } from './components/DPad';
import { DIR, SWIPE_THRESHOLD } from './constants';
import { isMusicEnabled, setMusicEnabled } from './music';
import { loadLoadout, saveLoadout } from './cosmetics/loadout';
import './index.css';

export default function App() {
  // All game state and actions come from a single hook
  const { headIdxRef, snakeLenRef, foodRef, obstaclesRef, score, best, levelIndex, state, banner, wrap, applyDir, pause, reset, toggleWrap } = useSnake();

  // Mode can only change between runs — useSnake ignores the toggle otherwise.
  const runActive = state === 'running' || state === 'paused';

  // Ref mirror of state so GameCanvas's rAF loop can read it without a React
  // re-render. Updated synchronously after each render via useEffect.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Music toggle ────────────────────────────────────────────────────────────
  // music.js owns the preference (and its localStorage persistence); this is
  // just a mirror so the button label re-renders.
  const [musicOn, setMusicOn] = useState(isMusicEnabled);
  const toggleMusic = useCallback(() => {
    const next = !isMusicEnabled();
    setMusicEnabled(next);
    setMusicOn(next);
  }, []);

  // ── Cosmetics (pause menu → Customize) ──────────────────────────────────────
  const [loadout, setLoadout] = useState(loadLoadout);
  const changeLoadout = useCallback((slot, id) => {
    setLoadout((prev) => {
      const next = { ...prev, [slot]: id };
      saveLoadout(next);
      return next;
    });
  }, []);

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

  // ── Board-width publisher ─────────────────────────────────────────────────
  // The board is sized in CSS from its slot (min of width, height and a cap),
  // so its width isn't known to the header/controls. Publish it as --board-w on
  // .app so those rows line up with the board edges at every viewport size.
  const appRef   = useRef(null);
  const boardRef = useRef(null);
  useLayoutEffect(() => {
    const app = appRef.current, board = boardRef.current;
    if (!app || !board || typeof ResizeObserver === 'undefined') return;
    const publish = () => app.style.setProperty('--board-w', `${Math.round(board.getBoundingClientRect().width)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(board);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="app" ref={appRef}>
      {/* Top bar: score + level badge + best */}
      <Scoreboard score={score} best={best} levelIndex={levelIndex} state={state} onPause={pause} />

      {/* Progress bar toward next speed level */}
      <LevelBar score={score} levelIndex={levelIndex} />

      {/* Game board — canvas + overlay stacked via position:absolute.
          Swipe handlers live here so the full board area responds to gestures.
          touchAction:'none' tells the browser not to scroll or zoom while the
          player's finger is on the canvas. */}
      <div className="board-slot">
        <div
          ref={boardRef}
          className="canvas-wrap"
          onTouchStart={handleSwipeStart}
          onTouchEnd={handleSwipeEnd}
          style={{ touchAction: 'none' }}
        >
          <GameCanvas
            headIdxRef={headIdxRef}
            snakeLenRef={snakeLenRef}
            foodRef={foodRef}
            obstaclesRef={obstaclesRef}
            levelIndex={levelIndex}
            stateRef={stateRef}
            wrap={wrap}
            loadout={loadout}
          />
          <Overlay
            state={state}
            score={score}
            levelIndex={levelIndex}
            banner={banner}
            onReset={reset}
            onPause={pause}
            loadout={loadout}
            onLoadout={changeLoadout}
          />
        </div>
      </div>

      {/* Mobile D-Pad (hidden on desktop via CSS media query) */}
      <DPad onDir={applyDir} levelIndex={levelIndex} />

      {/* Keyboard hint + quick-action buttons */}
      <div className="controls-hint">
        <span>WASD / Arrows / Swipe</span>
        <button className="ctrl-btn" onClick={pause}>
          {state === 'paused' ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button className="ctrl-btn" onClick={reset}>↺ Reset</button>
        <button
          className="ctrl-btn"
          onClick={toggleMusic}
          aria-pressed={musicOn}
          aria-label={musicOn ? 'Mute music' : 'Unmute music'}
        >
          {musicOn ? '🔊 Music' : '🔇 Music'}
        </button>
        <button
          className="ctrl-btn"
          onClick={toggleWrap}
          disabled={runActive}
          aria-pressed={wrap}
          aria-label={wrap ? 'Switch to classic walls' : 'Switch to wrap-around walls'}
          title={runActive ? 'Mode can be changed before a run or after game over' : undefined}
        >
          {wrap ? '🌀 Wrap' : '🧱 Walls'}
        </button>
      </div>
    </div>
  );
}
