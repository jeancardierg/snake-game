/**
 * Scoreboard — displays score, current level badge, and all-time best.
 *
 * Layout (left → center → right):
 *   [SCORE / value]   [LEVEL BADGE]   [BEST / value]
 *
 * The score value and badge are tinted with the current level's accent color.
 * Purely presentational — no logic, no side effects.
 *
 * Props:
 *   score       number   — current game score
 *   best        number   — all-time best score (from localStorage)
 *   levelIndex  number   — level index, resolved through getLevel for color and id
 *   state       string   — game state, drives the pause button label
 *   onPause     function — toggle pause/resume
 */
import { getLevel } from '../levels';

export function Scoreboard({ score, best, levelIndex, state, onPause }) {
  // The badge shows the short id ("L07"); the full title would overflow it.
  const level = getLevel(Math.max(levelIndex ?? 0, 0));

  // Flash on each score increase without state or effects: keying the span off
  // `score` remounts it whenever the score changes, which restarts the CSS
  // animation. The flash class is applied only when score > 0, so the initial
  // render and a reset-to-0 don't animate. Score only ever increases during
  // play, so "score changed to a value > 0" is equivalent to "score increased".
  return (
    <div className="scoreboard">
      <div className="score-block">
        <span className="score-label">SCORE</span>
        <span
          key={score}
          className={`score-value${score > 0 ? ' score-flash' : ''}`}
          style={{ color: level.color }}
        >
          {score}
        </span>
      </div>

      {/* Difficulty badge with a pause button centered directly below it */}
      <div className="level-card-center">
        <div
          className="level-badge"
          style={{
            background: level.color + '22',
            borderColor: level.color,
            boxShadow: `0 0 8px ${level.color}66`,
          }}
          title={level.title}
        >
          {level.id}
        </div>
        <button
          className="level-pause-btn"
          onClick={onPause}
          disabled={state === 'idle' || state === 'dead'}
          aria-label={state === 'paused' ? 'Resume game' : 'Pause game'}
          style={{ borderColor: level.color + '55' }}
        >
          {state === 'paused' ? '▶ Resume' : '⏸ Pause'}
        </button>
      </div>

      <div className="score-block">
        <span className="score-label">BEST</span>
        <span className="score-value">{best}</span>
      </div>
    </div>
  );
}
