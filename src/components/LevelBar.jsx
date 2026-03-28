/**
 * LevelBar — progress bar showing advancement toward the next level.
 *
 * Progress calculation:
 *   prev     = score threshold where the current level started (0 for level 0)
 *   current  = score threshold where the next level begins (level.scoreNext)
 *   progress = (score - prev) / (current - prev)   clamped to [0, 1]
 *
 * On the final level (INSANE, scoreNext = Infinity), progress is always 1
 * and the "MAX LEVEL" label replaces the next-level hint.
 *
 * Accessibility: has role="progressbar" with aria-valuenow so screen readers
 * can announce the current level progress as a percentage.
 *
 * Props:
 *   score       number  — current game score
 *   levelIndex  number  — current level index
 */
import { LEVELS } from '../constants';

export function LevelBar({ score, levelIndex }) {
  const safeIdx = Math.min(Math.max(levelIndex, 0), LEVELS.length - 1);
  const level = LEVELS[safeIdx];
  const next  = LEVELS[safeIdx + 1];  // undefined on the final level
  const prev  = safeIdx > 0 ? LEVELS[safeIdx - 1].scoreNext : 0;

  // On the final level next is undefined, so show a full bar (progress = 1)
  const progress = next
    ? Math.min(1, (score - prev) / (level.scoreNext - prev))
    : 1;

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

      {next ? (
        // Show next level name and score threshold
        <span className="level-bar-next" style={{ color: next.color }}>
          → {next.label} at {level.scoreNext}
        </span>
      ) : (
        // Player is on the final level
        <span className="level-bar-next" style={{ color: level.color }}>
          MAX LEVEL
        </span>
      )}
    </div>
  );
}
