/**
 * DPad — touch directional pad for mobile players.
 *
 * Rendered as four arrow buttons arranged in a cross shape.
 * Hidden on screens wider than 900px (CSS media query) where keyboard is assumed.
 *
 * Touch handling notes:
 *   - Uses onTouchEnd (not onTouchStart) so the action fires when the finger
 *     lifts, not the instant it touches. This avoids accidental inputs when
 *     swiping across buttons to reach a target.
 *   - A touch-ID set (handledTouches) prevents the browser's synthetic click
 *     event from firing a second time after the touch event completes.
 *   - onClick is kept so the D-Pad also works with mouse clicks.
 */
import { useRef } from 'react';
import { DIR, LEVELS } from '../constants';

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
 */
export function DPad({ onDir, levelIndex }) {
  const handledTouches = useRef(new Set());
  const safeIdx = Math.min(Math.max(levelIndex ?? 0, 0), LEVELS.length - 1);
  const level   = LEVELS[safeIdx];

  const handleTouchEnd = (dir) => (e) => {
    e.preventDefault();
    const id = e.changedTouches[0]?.identifier;
    if (id !== undefined) {
      if (handledTouches.current.has(id)) return;
      handledTouches.current.add(id);
      setTimeout(() => handledTouches.current.delete(id), 300);
    }
    onDir(dir);
  };

  return (
    <div
      className="dpad"
      aria-label="Directional controls"
      style={{ '--dpad-color': level.color }}
    >
      {DIRS.map(({ label, dir, pos, ariaLabel }) => (
        <button
          key={pos}
          className={`dpad-btn dpad-${pos}`}
          onTouchEnd={handleTouchEnd(dir)}
          onTouchCancel={(e) => e.preventDefault()}
          onClick={() => onDir(dir)}
          aria-label={ariaLabel}
          style={{ borderColor: level.color + '55' }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
