/**
 * LevelBar — progress bar showing advancement toward the next level.
 *
 * Progress calculation:
 *   prev     = score threshold where the current level started (0 for level 0)
 *   current  = score threshold where the next level begins (level.scoreNext)
 *   progress = (score - prev) / (current - prev)   clamped to [0, 1]
 *
 * Levels are endless (see levels.js), so there is always a next level and the
 * former "MAX LEVEL" state no longer exists.
 *
 * Accessibility: has role="progressbar" with aria-valuenow so screen readers
 * can announce the current level progress as a percentage.
 *
 * Props:
 *   score       number  — current game score
 *   levelIndex  number  — current level index
 */
import { getLevel } from '../levels';

export function LevelBar({ score, levelIndex }) {
  const safeIdx = Math.max(levelIndex ?? 0, 0);
  const level = getLevel(safeIdx);
  const next  = getLevel(safeIdx + 1);
  const prev  = safeIdx > 0 ? getLevel(safeIdx - 1).scoreNext : 0;

  const progress = Math.min(1, Math.max(0, (score - prev) / (level.scoreNext - prev)));

  return (
    <div className="level-bar-wrap">
      <div
        className="level-bar-track"
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Level progress: ${level.label}`}
      >
        {/* Fill width animates via CSS transition */}
        <div
          className="level-bar-fill"
          style={{
            width: `${progress * 100}%`,
            background: level.color,
            boxShadow: `0 0 6px ${level.color}`,
          }}
        />
      </div>

      {/* Next level identifier and the score that unlocks it */}
      <span className="level-bar-next" style={{ color: next.color }}>
        → {next.id} at {level.scoreNext}
      </span>
    </div>
  );
}
