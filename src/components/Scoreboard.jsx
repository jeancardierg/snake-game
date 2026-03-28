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
import { useState, useEffect, useRef } from 'react';
import { LEVELS } from '../constants';

export function Scoreboard({ score, best, levelIndex }) {
  const safeIdx = Math.min(Math.max(levelIndex, 0), LEVELS.length - 1);
  const level = LEVELS[safeIdx];

  // flashKey increments on each score increase; changing the key remounts the
  // span, restarting the CSS animation cleanly without extra state.
  const [flashKey, setFlashKey] = useState(0);
  const prevScoreRef = useRef(score);
  useEffect(() => {
    if (score > prevScoreRef.current) setFlashKey(k => k + 1);
    prevScoreRef.current = score;
  }, [score]);

  return (
    <div className="scoreboard">
      <div className="score-block">
        <span className="score-label">SCORE</span>
        <span
          key={flashKey}
          className={`score-value${flashKey > 0 ? ' score-flash' : ''}`}
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
