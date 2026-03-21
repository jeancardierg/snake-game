export const COLS = 20;
export const ROWS = 20;
export const CELL = 400 / COLS;

export const LEVELS = [
  { label: 'EASY',   speed: 200, scoreNext: 50,       color: '#4ecca3' },
  { label: 'MEDIUM', speed: 150, scoreNext: 120,      color: '#a0e060' },
  { label: 'FAST',   speed: 110, scoreNext: 220,      color: '#f0c040' },
  { label: 'HYPER',  speed: 80,  scoreNext: 360,      color: '#f07030' },
  { label: 'INSANE', speed: 55,  scoreNext: Infinity, color: '#e03060' },
];

export const DIR = {
  UP:    { x: 0,  y: -1 },
  DOWN:  { x: 0,  y: 1  },
  LEFT:  { x: -1, y: 0  },
  RIGHT: { x: 1,  y: 0  },
};
