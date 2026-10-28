/**
 * DPad — touch directional pad for mobile players.
 *
 * Uses onPointerDown (not onTouchEnd) so the action fires on first contact
 * rather than when the finger lifts. Works for both touch and mouse.
 * e.preventDefault() suppresses the trailing synthetic click event.
 * touch-action:none in CSS (already set) ensures no browser scroll delay.
 */
import { DIR } from '../constants';
import { getLevel } from '../levels';
import { markInput } from '../inputDebug';

// Direction vectors imported from constants so there is a single source of truth.
const DIRS = [
  { label: '▲', dir: DIR.UP,    pos: 'up',    ariaLabel: 'Move up' },
  { label: '◄', dir: DIR.LEFT,  pos: 'left',  ariaLabel: 'Move left' },
  { label: '▼', dir: DIR.DOWN,  pos: 'down',  ariaLabel: 'Move down' },
  { label: '►', dir: DIR.RIGHT, pos: 'right', ariaLabel: 'Move right' },
];

/**
 * Props:
 *   onDir       function({x,y})  — called with the chosen direction vector
 *   levelIndex  number           — used to tint the D-Pad accent color per level
 *   turn        boolean          — turn steering (Chase cam): only ◄ ► are shown,
 *                                  and they turn the snake left / right
 */
export function DPad({ onDir, levelIndex, turn = false }) {
  const level = getLevel(Math.max(levelIndex ?? 0, 0));

  const handlePointerDown = (dir) => (e) => {
    e.preventDefault();
    markInput(e);
    onDir(dir);
  };

  return (
    <div
      className="dpad"
      aria-label="Directional controls"
      style={{ '--dpad-color': level.color }}
    >
      {DIRS.filter(({ pos }) => !turn || pos === 'left' || pos === 'right').map(({ label, dir, pos, ariaLabel }) => (
        <button
          key={pos}
          className={`dpad-btn dpad-${pos}`}
          onPointerDown={handlePointerDown(dir)}
          aria-label={turn ? `Turn ${pos}` : ariaLabel}
          style={{ borderColor: level.color + '55' }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
