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

// Defined outside the component — static data, no need to recreate on each render
const DIRS = [
  { label: '▲', dir: { x: 0, y: -1 }, pos: 'up',    ariaLabel: 'Move up' },
  { label: '◄', dir: { x: -1, y: 0 }, pos: 'left',  ariaLabel: 'Move left' },
  { label: '▼', dir: { x: 0, y: 1 },  pos: 'down',  ariaLabel: 'Move down' },
  { label: '►', dir: { x: 1, y: 0 },  pos: 'right', ariaLabel: 'Move right' },
];

/**
 * Props:
 *   onDir  function({x,y})  — called with the chosen direction vector
 */
export function DPad({ onDir }) {
  // Set of touch identifiers currently being handled.
  // Prevents the synthesized 'click' event that browsers fire after touchend
  // from triggering onDir a second time on the same tap.
  const handledTouches = useRef(new Set());

  const handleTouchEnd = (dir) => (e) => {
    e.preventDefault();  // suppress the synthetic click that follows touchend
    const id = e.changedTouches[0]?.identifier;
    if (id !== undefined) {
      if (handledTouches.current.has(id)) return;  // already processed
      handledTouches.current.add(id);
      // Remove from set after a short window so the ID can be reused later
      setTimeout(() => handledTouches.current.delete(id), 300);
    }
    onDir(dir);
  };

  return (
    // aria-label identifies the group of buttons to screen readers
    <div className="dpad" aria-label="Directional controls">
      {DIRS.map(({ label, dir, pos, ariaLabel }) => (
        <button
          key={pos}
          className={`dpad-btn dpad-${pos}`}
          onTouchEnd={handleTouchEnd(dir)}
          onTouchCancel={(e) => e.preventDefault()}
          onClick={() => onDir(dir)}       // fallback for mouse / keyboard activation
          aria-label={ariaLabel}           // e.g. "Move up" — clearer than bare "up"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
