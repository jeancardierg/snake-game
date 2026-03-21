import { LEVELS } from '../constants';

export function Overlay({ state, score, levelIndex, onReset, onPause }) {
  if (state === 'running') return null;

  const level = LEVELS[levelIndex];

  if (state === 'idle') {
    return (
      <div className="overlay">
        <h1 className="overlay-title">SNAKE</h1>
        <p className="overlay-hint">Arrow keys / WASD to start</p>
        <p className="overlay-hint small">P to pause · Mobile: D-Pad below</p>
      </div>
    );
  }

  if (state === 'paused') {
    return (
      <div className="overlay">
        <h2 className="overlay-title">PAUSED</h2>
        <button className="overlay-btn" onClick={onPause}>Resume</button>
      </div>
    );
  }

  if (state === 'dead') {
    return (
      <div className="overlay">
        <h2 className="overlay-title" style={{ color: '#ff4757' }}>GAME OVER</h2>
        <p className="overlay-score">Score: <span style={{ color: level.color }}>{score}</span></p>
        <p className="overlay-hint small">Level reached: {level.label}</p>
        <button className="overlay-btn" onClick={onReset}>Play Again</button>
        <p className="overlay-hint small">or press Enter / Space</p>
      </div>
    );
  }

  return null;
}
