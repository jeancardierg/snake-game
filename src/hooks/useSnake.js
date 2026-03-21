import { useState, useEffect, useRef, useCallback } from 'react';
import { COLS, ROWS, LEVELS } from '../constants';

const INIT_SNAKE = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
const INIT_DIR   = { x: 1, y: 0 };

function randomFood(snake) {
  let pos;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  } while (snake.some(s => s.x === pos.x && s.y === pos.y));
  return pos;
}

export function useSnake() {
  const [snake, setSnake]       = useState(INIT_SNAKE);
  const [food, setFood]         = useState({ x: 15, y: 10 });
  const [score, setScore]       = useState(0);
  const [best, setBest]         = useState(() => parseInt(localStorage.getItem('snakeBest') || '0'));
  const [levelIndex, setLevel]  = useState(0);
  const [state, setState]       = useState('idle'); // idle | running | paused | dead

  const dirRef     = useRef(INIT_DIR);
  const nextDirRef = useRef(INIT_DIR);
  const snakeRef   = useRef(INIT_SNAKE);
  const foodRef    = useRef({ x: 15, y: 10 });
  const scoreRef   = useRef(0);
  const bestRef    = useRef(parseInt(localStorage.getItem('snakeBest') || '0'));
  const levelRef   = useRef(0);
  const intervalRef = useRef(null);
  const stateRef   = useRef('idle');

  const stopLoop = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const startLoop = useCallback((lvlIdx) => {
    stopLoop();
    intervalRef.current = setInterval(() => tick(), LEVELS[lvlIdx ?? levelRef.current].speed);
  }, []);

  const tick = useCallback(() => {
    dirRef.current = { ...nextDirRef.current };
    const head = {
      x: snakeRef.current[0].x + dirRef.current.x,
      y: snakeRef.current[0].y + dirRef.current.y,
    };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      return die();
    }
    if (snakeRef.current.some(s => s.x === head.x && s.y === head.y)) {
      return die();
    }

    const newSnake = [head, ...snakeRef.current];
    const ate = head.x === foodRef.current.x && head.y === foodRef.current.y;

    if (ate) {
      const newScore = scoreRef.current + 10;
      scoreRef.current = newScore;
      setScore(newScore);

      if (newScore > bestRef.current) {
        bestRef.current = newScore;
        setBest(newScore);
        localStorage.setItem('snakeBest', newScore);
      }

      // Level up check
      let lvl = levelRef.current;
      while (lvl < LEVELS.length - 1 && newScore >= LEVELS[lvl].scoreNext) lvl++;
      if (lvl !== levelRef.current) {
        levelRef.current = lvl;
        setLevel(lvl);
        startLoop(lvl);
      }

      const newFood = randomFood(newSnake);
      foodRef.current = newFood;
      setFood(newFood);
    } else {
      newSnake.pop();
    }

    snakeRef.current = newSnake;
    setSnake([...newSnake]);
  }, [startLoop]);

  const die = useCallback(() => {
    stopLoop();
    stateRef.current = 'dead';
    setState('dead');
  }, []);

  const applyDir = useCallback((newDir) => {
    const cur = dirRef.current;
    if (newDir.x === -cur.x && newDir.y === -cur.y) return;
    nextDirRef.current = newDir;
    if (stateRef.current === 'idle') {
      stateRef.current = 'running';
      setState('running');
      startLoop(levelRef.current);
    }
  }, [startLoop]);

  const pause = useCallback(() => {
    if (stateRef.current === 'running') {
      stopLoop();
      stateRef.current = 'paused';
      setState('paused');
    } else if (stateRef.current === 'paused') {
      stateRef.current = 'running';
      setState('running');
      startLoop(levelRef.current);
    }
  }, [startLoop]);

  const reset = useCallback(() => {
    stopLoop();
    const initSnake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const initDir   = { x: 1, y: 0 };
    const initFood  = randomFood(initSnake);
    snakeRef.current    = initSnake;
    dirRef.current      = initDir;
    nextDirRef.current  = initDir;
    foodRef.current     = initFood;
    scoreRef.current    = 0;
    levelRef.current    = 0;
    stateRef.current    = 'idle';
    setSnake(initSnake);
    setFood(initFood);
    setScore(0);
    setLevel(0);
    setState('idle');
  }, []);

  // Keyboard handler
  useEffect(() => {
    const keyMap = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
      a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    };
    const onKey = (e) => {
      if (e.key === 'p' || e.key === 'P') { pause(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && stateRef.current === 'dead') { reset(); return; }
      const dir = keyMap[e.key];
      if (!dir) return;
      e.preventDefault();
      applyDir(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyDir, pause, reset]);

  return { snake, food, score, best, levelIndex, state, applyDir, pause, reset };
}
