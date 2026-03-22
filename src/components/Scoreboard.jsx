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
  const level = LEVELS[levelIndex] ?? LEVELS[LEVELS.length - 1];
  return (
    <div className="scoreboard">
      <div className="score-block">
        <span className="score-label">SCORE</span>
        {/* Score colored with the current level's accent */}
        <span className="score-value" style={{ color: level.color }}>{score}</span>
      </div>

      {/* Level badge — tinted background (22 hex = ~13% opacity) + colored border */}
      <div
        className="level-badge"
        style={{ background: level.color + '22', borderColor: level.color }}
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
