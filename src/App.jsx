import { useSnake } from './hooks/useSnake';
import { GameCanvas } from './components/GameCanvas';
import { Scoreboard } from './components/Scoreboard';
import { LevelBar } from './components/LevelBar';
import { DPad } from './components/DPad';
import { Overlay } from './components/Overlay';
import './index.css';

export default function App() {
  const { snake, food, score, best, levelIndex, state, applyDir, pause, reset } = useSnake();

  return (
    <div className="app">
      <Scoreboard score={score} best={best} levelIndex={levelIndex} />
      <LevelBar score={score} levelIndex={levelIndex} />

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

      <div className="controls-hint">
        <span>WASD / Arrows</span>
        <button className="ctrl-btn" onClick={pause}>
          {state === 'paused' ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button className="ctrl-btn" onClick={reset}>↺ Reset</button>
      </div>

      <DPad onDir={applyDir} />
    </div>
  );
}
