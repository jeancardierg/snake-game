/**
 * useSnake — the complete game engine.
 *
 * This hook is the single source of truth for all game state and logic.
 * It owns the tick loop, state machine, input queue, and side effects.
 * No component is allowed to mutate game state directly.
 *
 * Returns:
 *   headIdxRef  React.MutableRefObject<number>  — pool head index (for GameCanvas)
 *   snakeLenRef React.MutableRefObject<number>  — live segment count (for GameCanvas)
 *   foodRef     React.MutableRefObject<{x,y}>   — current food position (for GameCanvas)
 *   score       number    — current score
 *   best        number    — all-time best (persisted in localStorage)
 *   levelIndex  number    — current level index into LEVELS (0–4)
 *   state       string    — 'idle' | 'running' | 'paused' | 'dead'
 *   applyDir    function  — queue a new direction ({x,y})
 *   pause       function  — toggle pause/resume
 *   reset       function  — restart the game from scratch
 *
 * Rendering decoupling:
 *   snake and food are no longer returned as React state. Instead, headIdxRef,
 *   snakeLenRef, and foodRef are refs that GameCanvas reads directly inside a
 *   requestAnimationFrame loop — eliminating React reconciliation on every tick.
 *   score, best, levelIndex, and state remain as React state because they drive
 *   non-canvas UI (Scoreboard, LevelBar, Overlay, buttons).
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { COLS, ROWS, LEVELS } from '../constants';
import { POOL_SIZE, segPool, initPool, poolPrepend, poolGet } from '../pool';

// ─── Initial values ───────────────────────────────────────────────────────────
const INIT_SNAKE = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
const INIT_DIR   = { x: 1, y: 0 };  // starts moving right

// Seed the pool with the initial snake on module load.
// reset() re-seeds on every game restart.
initPool(INIT_SNAKE);

/**
 * Read the persisted best score from localStorage.
 * Called once at module load — result shared by both useState and useRef
 * initialisers so the two values are guaranteed to be identical.
 * Logs a warning (never throws) when storage is unavailable.
 */
function readBestScore() {
  try {
    return parseInt(localStorage.getItem('snakeBest') || '0', 10);
  } catch (e) {
    console.warn('[useSnake] localStorage unavailable:', e.message);
    return 0;
  }
}
const INIT_BEST = readBestScore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pick a random grid cell not occupied by the snake ring buffer.
 * headIdx / snakeLen describe the current ring state in segPool.
 * Includes an iteration cap so a nearly-full board can't loop forever.
 */
function randomFood(headIdx, snakeLen) {
  let pos;
  let attempts = 0;
  let occupied;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    attempts++;
    occupied = false;
    for (let i = 0; i < snakeLen; i++) {
      const s = segPool[(headIdx + i) % POOL_SIZE];
      if (s.x === pos.x && s.y === pos.y) { occupied = true; break; }
    }
  } while (attempts < 1000 && occupied);
  if (occupied) return null;  // board too full; caller keeps existing food
  return pos;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSnake() {

  // ── React state (drives non-canvas UI re-renders) ───────────────────────────
  // snake and food are intentionally NOT state — GameCanvas reads refs directly.
  const [score, setScore]       = useState(0);
  const [best, setBest]         = useState(INIT_BEST);
  const [levelIndex, setLevel]  = useState(0);
  const [state, setState]       = useState('idle');

  // ── Refs (readable inside setInterval without stale-closure issues) ──────────
  const dirRef      = useRef(INIT_DIR);
  const dirQueueRef = useRef([]);

  // Ring buffer position — shared with GameCanvas (read-only from GameCanvas side)
  const headIdxRef  = useRef(0);                // index of head segment in segPool
  const snakeLenRef = useRef(INIT_SNAKE.length);// live segment count

  const foodRef     = useRef({ x: 15, y: 10 });
  const scoreRef    = useRef(0);
  const bestRef     = useRef(INIT_BEST);
  const levelRef    = useRef(0);
  const intervalRef = useRef(null);
  const stateRef    = useRef('idle');

  // tickRef holds a reference to the latest tick callback.
  // startLoop's setInterval calls tickRef.current() instead of tick() directly.
  const tickRef = useRef(null);

  // ── Loop control ─────────────────────────────────────────────────────────────

  const stopLoop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startLoop = useCallback((lvlIdx) => {
    stopLoop();
    intervalRef.current = setInterval(
      () => tickRef.current?.(),
      LEVELS[lvlIdx ?? levelRef.current].speed
    );
  }, [stopLoop]);

  // ── State machine actions ─────────────────────────────────────────────────────
  // die() is declared before tick() so tick() can call it without a forward reference.

  const die = useCallback(() => {
    stopLoop();
    stateRef.current = 'dead';
    setState('dead');
  }, [stopLoop]);

  // ── Core tick ─────────────────────────────────────────────────────────────────

  /**
   * Called every N ms by setInterval. One tick = one grid step.
   *
   * Steps:
   *  1. Consume the next queued direction (reject 180° reversals).
   *  2. Compute new head position.
   *  3. Collision checks (wall, self) → die().
   *  4. Prepend new head into ring buffer (in-place, zero allocation).
   *  5. Food check:
   *     - YES: score, best, level-up, new food  (tail kept → grows)
   *     - NO:  shrink snakeLen by 1             (tail "popped" by not counting it)
   *  6. No setState for snake/food — GameCanvas reads refs directly via rAF.
   */
  const tick = useCallback(() => {
    // 1. Dequeue next direction
    if (dirQueueRef.current.length > 0) {
      const next = dirQueueRef.current.shift();
      const cur  = dirRef.current;
      if (!(next.x === -cur.x && next.y === -cur.y)) {
        dirRef.current = next;
      }
    }

    // 2. New head = current head + direction vector
    const curHead = poolGet(headIdxRef.current, 0);
    const hx = curHead.x + dirRef.current.x;
    const hy = curHead.y + dirRef.current.y;

    // 3a. Wall collision
    if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS) {
      return die();
    }

    // 3b. Self collision — check all current segments before prepend
    const snakeLen = snakeLenRef.current;
    for (let i = 0; i < snakeLen; i++) {
      const s = segPool[(headIdxRef.current + i) % POOL_SIZE];
      if (s.x === hx && s.y === hy) return die();
    }

    // 4. Prepend new head in-place (no allocation)
    headIdxRef.current = poolPrepend(headIdxRef.current, hx, hy);
    snakeLenRef.current++;
    // Dev-only overflow guard: the snake can never legitimately reach POOL_SIZE
    // (self-collision kills it first), so this fires only if there is a bug.
    if (import.meta.env.DEV && snakeLenRef.current > POOL_SIZE) {
      console.error('[useSnake] snake length exceeded POOL_SIZE — ring buffer overflow imminent');
    }

    const ate = hx === foodRef.current.x && hy === foodRef.current.y;

    if (ate) {
      // 5a. Ate food: grow (tail kept, length stays incremented), update score
      const newScore = scoreRef.current + 10;
      scoreRef.current = newScore;
      setScore(newScore);

      if (newScore > bestRef.current) {
        bestRef.current = newScore;
        setBest(newScore);
        try { localStorage.setItem('snakeBest', String(newScore)); } catch (e) { console.warn('[useSnake] localStorage write failed:', e.message); }
      }

      // Level-up: while loop handles jumping past multiple thresholds at once
      let lvl = levelRef.current;
      while (lvl < LEVELS.length - 1 && newScore >= LEVELS[lvl].scoreNext) lvl++;
      if (lvl !== levelRef.current) {
        levelRef.current = lvl;
        setLevel(lvl);
        startLoop(lvl);
      }

      // Spawn new food at a free cell
      const newFood = randomFood(headIdxRef.current, snakeLenRef.current);
      if (newFood) {
        foodRef.current = newFood;
      }
      // Tail is NOT shrunk → snake is longer by 1
    } else {
      // 5b. No food: pop tail by shrinking length (object stays in pool, no GC)
      snakeLenRef.current--;
    }

    // No setSnake / setFood — GameCanvas reads headIdxRef/snakeLenRef/foodRef directly.
  }, [startLoop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep tickRef pointing to the latest tick after every render.
  // useLayoutEffect runs synchronously after DOM mutations, before paint,
  // ensuring the interval always calls the most-recent tick closure.
  useLayoutEffect(() => { tickRef.current = tick; });

  const applyDir = useCallback((newDir) => {
    const last = dirQueueRef.current.length > 0
      ? dirQueueRef.current[dirQueueRef.current.length - 1]
      : dirRef.current;

    if (newDir.x === -last.x && newDir.y === -last.y) return;
    if (newDir.x === last.x  && newDir.y === last.y)  return;

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
    const initSegs = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    headIdxRef.current  = initPool(initSegs);   // returns 0; fills pool
    snakeLenRef.current = initSegs.length;
    dirRef.current      = { x: 1, y: 0 };
    dirQueueRef.current = [];
    const initFood = randomFood(headIdxRef.current, snakeLenRef.current);
    foodRef.current     = initFood ?? { x: 15, y: 10 };
    scoreRef.current    = 0;
    levelRef.current    = 0;
    stateRef.current    = 'idle';
    setScore(0);
    setLevel(0);
    setState('idle');
  }, [stopLoop]);

  // ── Side effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const keyMap = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
      a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    };
    const onKey = (e) => {
      if (e.key === 'p' || e.key === 'P') { pause(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && stateRef.current === 'dead') {
        reset(); return;
      }
      const dir = keyMap[e.key];
      if (!dir) return;
      e.preventDefault();
      applyDir(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyDir, pause, reset]);

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

  useEffect(() => {
    return () => stopLoop();
  }, [stopLoop]);

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    // Refs for GameCanvas (read directly, no React round-trip)
    headIdxRef, snakeLenRef, foodRef,
    // React state for non-canvas UI
    score, best, levelIndex, state,
    // Actions
    applyDir, pause, reset,
  };
}
