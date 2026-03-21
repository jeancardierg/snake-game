import { useRef } from 'react';

const DIRS = [
  { label: '▲', dir: { x: 0, y: -1 }, pos: 'up',    ariaLabel: 'Move up' },
  { label: '◄', dir: { x: -1, y: 0 }, pos: 'left',  ariaLabel: 'Move left' },
  { label: '▼', dir: { x: 0, y: 1 },  pos: 'down',  ariaLabel: 'Move down' },
  { label: '►', dir: { x: 1, y: 0 },  pos: 'right', ariaLabel: 'Move right' },
];

export function DPad({ onDir }) {
  // Track which touch IDs are already handled to prevent double-fire
  const handledTouches = useRef(new Set());

  const handleTouchEnd = (dir) => (e) => {
    e.preventDefault();
    const id = e.changedTouches[0]?.identifier;
    if (id !== undefined && handledTouches.current.has(id)) return;
    if (id !== undefined) {
      handledTouches.current.add(id);
      // Clean up after a short delay
      setTimeout(() => handledTouches.current.delete(id), 300);
    }
    onDir(dir);
  };

  return (
    <div className="dpad" aria-label="Directional controls">
      {DIRS.map(({ label, dir, pos, ariaLabel }) => (
        <button
          key={pos}
          className={`dpad-btn dpad-${pos}`}
          onTouchEnd={handleTouchEnd(dir)}
          onTouchCancel={(e) => e.preventDefault()}
          onClick={() => onDir(dir)}
          aria-label={ariaLabel}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
