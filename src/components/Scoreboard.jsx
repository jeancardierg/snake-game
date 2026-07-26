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
 *   score       number  — current game score
 *   best        number  — all-time best score (from localStorage)
 *   levelIndex  number  — index into LEVELS for color and label
 */
import { LEVELS } from '../constants';

export function Scoreboard({ score, best, levelIndex }) {
  const safeIdx = Math.min(Math.max(levelIndex, 0), LEVELS.length - 1);
  const level = LEVELS[safeIdx];

  return (
    <div className="scoreboard">
      <div className="score-block">
        <span className="score-label">SCORE</span>
        {/* key={score} remounts the span whenever the score changes, which
            restarts the CSS flash animation with no state or effect. score > 0
            gates the animation so it never fires on first render or after a
            reset to 0 (score only ever increases during play). */}
        <span
          key={score}
          className={`score-value${score > 0 ? ' score-flash' : ''}`}
          style={{ color: level.color }}
        >
          {score}
        </span>
      </div>

      <div
        className="level-badge"
        style={{
          background: level.color + '22',
          borderColor: level.color,
          boxShadow: `0 0 8px ${level.color}66`,
        }}
      >
        {level.label}
      </div>

      <div className="score-block">
        <span className="score-label">BEST</span>
        <span className="score-value">{best}</span>
      </div>
    </div>
  );
}
