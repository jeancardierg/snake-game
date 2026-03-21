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
 *   <DPad>         touch directional pad (hidden on desktop)
 */
import { useSnake } from './hooks/useSnake';
import { GameCanvas } from './components/GameCanvas';
import { Scoreboard } from './components/Scoreboard';
import { LevelBar } from './components/LevelBar';
import { DPad } from './components/DPad';
import { Overlay } from './components/Overlay';
import './index.css';

export default function App() {
  // All game state and actions come from a single hook
  const { snake, food, score, best, levelIndex, state, applyDir, pause, reset } = useSnake();

  return (
    <div className="app">
      {/* Top bar: score + level badge + best */}
      <Scoreboard score={score} best={best} levelIndex={levelIndex} />

      {/* Progress bar toward next speed level */}
      <LevelBar score={score} levelIndex={levelIndex} />

      {/* Game board — canvas + overlay stacked via position:absolute */}
      <div className="canvas-wrap">
        <GameCanvas snake={snake} food={food} levelIndex={levelIndex} />
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
        <span>WASD / Arrows</span>
        <button className="ctrl-btn" onClick={pause}>
          {state === 'paused' ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button className="ctrl-btn" onClick={reset}>↺ Reset</button>
      </div>

      {/* Mobile touch controls — hidden on wide screens via CSS */}
      <DPad onDir={applyDir} />
    </div>
  );
}
