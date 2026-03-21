import { LEVELS } from '../constants';

export function LevelBar({ score, levelIndex }) {
  const level = LEVELS[levelIndex];
  const next = LEVELS[levelIndex + 1];
  const prev = levelIndex > 0 ? LEVELS[levelIndex - 1].scoreNext : 0;
  const progress = next
    ? Math.min(1, (score - prev) / (level.scoreNext - prev))
    : 1;

  return (
    <div className="level-bar-wrap">
      <div className="level-bar-track">
        <div
          className="level-bar-fill"
          style={{ width: `${progress * 100}%`, background: level.color }}
        />
      </div>
      {next && (
        <span className="level-bar-next" style={{ color: LEVELS[levelIndex + 1].color }}>
          → {next.label} at {level.scoreNext}
        </span>
      )}
    </div>
  );
}
