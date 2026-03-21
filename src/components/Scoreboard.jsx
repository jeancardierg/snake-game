import { LEVELS } from '../constants';

export function Scoreboard({ score, best, levelIndex }) {
  const level = LEVELS[levelIndex];
  return (
    <div className="scoreboard">
      <div className="score-block">
        <span className="score-label">SCORE</span>
        <span className="score-value" style={{ color: level.color }}>{score}</span>
      </div>
      <div className="level-badge" style={{ background: level.color + '22', borderColor: level.color }}>
        {level.label}
      </div>
      <div className="score-block">
        <span className="score-label">BEST</span>
        <span className="score-value">{best}</span>
      </div>
    </div>
  );
}
