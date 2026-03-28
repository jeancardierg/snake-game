/**
 * Overlay — full-canvas panel shown when the game is not actively running.
 *
 * Renders a semi-transparent screen with state-specific content:
 *
 *   idle   → Title + keyboard/mobile hints (shown before first input)
 *   paused → "PAUSED" title + Resume button
 *   dead   → "GAME OVER" + final score + level reached + Play Again button
 *
 * Returns null when state === 'running' so nothing obscures the canvas during play.
 *
 * Props:
 *   state       string    — 'idle' | 'running' | 'paused' | 'dead'
 *   score       number    — current/final score (shown on game over screen)
 *   levelIndex  number    — level at time of death (shown on game over screen)
 *   onReset     function  — called when "Play Again" is clicked
 *   onPause     function  — called when "Resume" is clicked
 */
import { LEVELS } from '../constants';

export function Overlay({ state, score, levelIndex, onReset, onPause }) {
  // During active play, render nothing — let the canvas show through
  if (state === 'running') return null;

  const level = LEVELS[levelIndex] ?? LEVELS[LEVELS.length - 1];

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
        <button className="overlay-btn" onClick={onPause} style={{ background: level.color }}>Resume</button>
      </div>
    );
  }

  if (state === 'dead') {
    return (
      <div className="overlay">
        <h2 className="overlay-title" style={{ color: '#ff4757' }}>GAME OVER</h2>
        <p className="overlay-score">
          Score: <span style={{ color: level.color }}>{score}</span>
        </p>
        <p className="overlay-hint small">Level reached: {level.label}</p>
        <button className="overlay-btn" onClick={onReset} style={{ background: level.color }}>Play Again</button>
        <p className="overlay-hint small">or press Enter / Space</p>
      </div>
    );
  }

  return null;
}
