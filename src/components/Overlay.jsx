/**
 * Overlay — full-canvas panel shown when the game is not actively running,
 * plus a transient level-up banner shown *during* play.
 *
 * Renders a semi-transparent screen with state-specific content:
 *
 *   idle   → Title + level identifier + keyboard/mobile hints
 *   paused → "PAUSED" title + Resume button
 *   dead   → "GAME OVER" + final score + level reached + Play Again button
 *
 * While state === 'running' the component renders nothing, unless `banner` is
 * set — then it renders only the level-up banner, which is click-through
 * (pointer-events: none) so it never interferes with play.
 *
 * Props:
 *   state       string    — 'idle' | 'running' | 'paused' | 'dead'
 *   score       number    — current/final score (shown on game over screen)
 *   levelIndex  number    — level at time of death (shown on game over screen)
 *   banner      object    — level descriptor to announce, or null
 *   onReset     function  — called when "Play Again" is clicked
 *   onPause     function  — called when "Resume" is clicked
 */
import { getLevel } from '../levels';

/** Transient "LEVEL 07 · EMBERFALL" announcement, click-through by design. */
function LevelBanner({ level }) {
  return (
    <div className="overlay-banner" aria-live="polite">
      <span className="overlay-banner-kicker">LEVEL UP</span>
      <span className="overlay-banner-title" style={{ color: level.color }}>
        {level.title}
      </span>
    </div>
  );
}

export function Overlay({ state, score, levelIndex, banner, onReset, onPause }) {
  // During active play, render nothing but the level-up banner (if any) — the
  // canvas must stay visible and interactive.
  if (state === 'running') {
    return banner ? <LevelBanner level={banner} /> : null;
  }

  const level = getLevel(levelIndex);

  if (state === 'idle') {
    return (
      <div className="overlay">
        <h1 className="overlay-title">SNAKE</h1>
        <p className="overlay-level-id" style={{ color: level.color }}>{level.title}</p>
        <p className="overlay-hint">Arrow keys / WASD to start</p>
        <p className="overlay-hint small">P to pause · Mobile: D-Pad below</p>
      </div>
    );
  }

  if (state === 'paused') {
    return (
      <div className="overlay">
        <h2 className="overlay-title">PAUSED</h2>
        <p className="overlay-level-id" style={{ color: level.color }}>{level.title}</p>
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
        <p className="overlay-level-id" style={{ color: level.color }}>{level.title}</p>
        <button className="overlay-btn" onClick={onReset} style={{ background: level.color }}>Play Again</button>
        <p className="overlay-hint small">or press Enter / Space</p>
      </div>
    );
  }

  return null;
}
