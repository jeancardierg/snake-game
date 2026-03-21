import { LEVELS } from '../constants';

export function LevelBar({ score, levelIndex }) {
  const level = LEVELS[levelIndex];
  const next  = LEVELS[levelIndex + 1];
  const prev  = levelIndex > 0 ? LEVELS[levelIndex - 1].scoreNext : 0;
  // Final level: show full bar
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
        <div
          className="level-bar-fill"
          style={{ width: `${progress * 100}%`, background: level.color }}
        />
      </div>
      {next ? (
        <span className="level-bar-next" style={{ color: next.color }}>
          → {next.label} at {level.scoreNext}
        </span>
      ) : (
        <span className="level-bar-next" style={{ color: level.color }}>
          MAX LEVEL
        </span>
      )}
    </div>
  );
}
