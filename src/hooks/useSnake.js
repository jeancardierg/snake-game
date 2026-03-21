import { useState, useEffect, useRef, useCallback } from 'react';
import { COLS, ROWS, LEVELS } from '../constants';

const INIT_SNAKE = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
const INIT_DIR   = { x: 1, y: 0 };

function randomFood(snake) {
  let pos;
  let attempts = 0;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    attempts++;
  } while (attempts < 1000 && snake.some(s => s.x === pos.x && s.y === pos.y));
  return pos;
}

export function useSnake() {
  const [snake, setSnake]       = useState(INIT_SNAKE);
  const [food, setFood]         = useState({ x: 15, y: 10 });
  const [score, setScore]       = useState(0);
  const [best, setBest]         = useState(() => parseInt(localStorage.getItem('snakeBest') || '0'));
  const [levelIndex, setLevel]  = useState(0);
  const [state, setState]       = useState('idle'); // idle | running | paused | dead

  const dirRef      = useRef(INIT_DIR);
  // Input queue: buffer up to 2 pending directions so rapid inputs aren't lost
  const dirQueueRef = useRef([]);
  const snakeRef    = useRef(INIT_SNAKE);
  const foodRef     = useRef({ x: 15, y: 10 });
  const scoreRef    = useRef(0);
  const bestRef     = useRef(parseInt(localStorage.getItem('snakeBest') || '0'));
  const levelRef    = useRef(0);
  const intervalRef = useRef(null);
  const stateRef    = useRef('idle');

  const stopLoop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // tick and startLoop share a ref to avoid circular useCallback dependency
  const tickRef = useRef(null);

  const startLoop = useCallback((lvlIdx) => {
    stopLoop();
    intervalRef.current = setInterval(
      () => tickRef.current?.(),
      LEVELS[lvlIdx ?? levelRef.current].speed
    );
  }, [stopLoop]);

  const tick = useCallback(() => {
    // Consume next queued direction
    if (dirQueueRef.current.length > 0) {
      const next = dirQueueRef.current.shift();
      const cur = dirRef.current;
      // Reject 180-degree reversal
      if (!(next.x === -cur.x && next.y === -cur.y)) {
        dirRef.current = next;
      }
    }

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
        // Write best only when beaten (not every tick)
        localStorage.setItem('snakeBest', String(newScore));
      }

      // Level up
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
  }, [startLoop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep tickRef current so startLoop's setInterval always calls the latest tick
  tickRef.current = tick;

  const die = useCallback(() => {
    stopLoop();
    stateRef.current = 'dead';
    setState('dead');
  }, [stopLoop]);

  const applyDir = useCallback((newDir) => {
    // Determine what current direction will be after queued moves
    const last = dirQueueRef.current.length > 0
      ? dirQueueRef.current[dirQueueRef.current.length - 1]
      : dirRef.current;
    // Reject 180-degree reversal and duplicates
    if (newDir.x === -last.x && newDir.y === -last.y) return;
    if (newDir.x === last.x && newDir.y === last.y) return;
    // Cap queue at 2
    if (dirQueueRef.current.length < 2) {
      dirQueueRef.current.push(newDir);
    }
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
  }, [startLoop, stopLoop]);

  const reset = useCallback(() => {
    stopLoop();
    const initSnake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const initDir   = { x: 1, y: 0 };
    const initFood  = randomFood(initSnake);
    snakeRef.current    = initSnake;
    dirRef.current      = initDir;
    dirQueueRef.current = [];
    foodRef.current     = initFood;
    scoreRef.current    = 0;
    levelRef.current    = 0;
    stateRef.current    = 'idle';
    setSnake(initSnake);
    setFood(initFood);
    setScore(0);
    setLevel(0);
    setState('idle');
  }, [stopLoop]);

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

  // Auto-pause when tab loses visibility
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && stateRef.current === 'running') {
        stopLoop();
        stateRef.current = 'paused';
        setState('paused');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stopLoop]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => stopLoop();
  }, [stopLoop]);

  return { snake, food, score, best, levelIndex, state, applyDir, pause, reset };
}
