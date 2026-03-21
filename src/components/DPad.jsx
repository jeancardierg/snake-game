export function DPad({ onDir }) {
  const dirs = [
    { label: '▲', dir: { x: 0, y: -1 }, pos: 'up' },
    { label: '◄', dir: { x: -1, y: 0 }, pos: 'left' },
    { label: '▼', dir: { x: 0, y: 1 }, pos: 'down' },
    { label: '►', dir: { x: 1, y: 0 }, pos: 'right' },
  ];

  const handleTouch = (dir) => (e) => {
    e.preventDefault();
    onDir(dir);
  };

  return (
    <div className="dpad">
      {dirs.map(({ label, dir, pos }) => (
        <button
          key={pos}
          className={`dpad-btn dpad-${pos}`}
          onTouchStart={handleTouch(dir)}
          onClick={() => onDir(dir)}
          aria-label={pos}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
