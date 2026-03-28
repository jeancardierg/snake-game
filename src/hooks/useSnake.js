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
import { COLS, ROWS, LEVELS, DIR_QUEUE_MAX, SPEED_PER_FOOD, SPEED_FLOOR } from '../constants';
import { POOL_SIZE, segPool, initPool, poolPrepend, poolGet } from '../pool';

// ─── Initial values ───────────────────────────────────────────────────────────
const INIT_SNAKE = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
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
// Note: INIT_BEST intentionally NOT computed here at module load.
// useState(readBestScore) uses the function as a lazy initializer so it runs
// on the hook's first render — this ensures localStorage is read fresh for
// each hook instance (critical for test isolation and React Strict Mode).

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pick a random free grid cell not occupied by the snake.
 *
 * O(n) implementation: build a Set of occupied cells once, then sample
 * from the list of free cells directly. Avoids the O(n²) retry loop that
 * the previous random-probe approach caused on large snakes.
 *
 * Returns null only when every cell is occupied (board full = game won).
 * Caller is responsible for handling null without moving the food.
 */
function randomFood(headIdx, snakeLen) {
  // Build occupied set in one pass
  const occupied = new Set();
  for (let i = 0; i < snakeLen; i++) {
    const s = segPool[(headIdx + i) % POOL_SIZE];
    occupied.add(s.x * ROWS + s.y);
  }

  // Collect all free cells
  const free = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (!occupied.has(x * ROWS + y)) free.push({ x, y });
    }
  }

  if (free.length === 0) return null;  // board full
  return free[Math.floor(Math.random() * free.length)];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSnake() {

  // ── React state (drives non-canvas UI re-renders) ───────────────────────────
  // snake and food are intentionally NOT state — GameCanvas reads refs directly.
  const [score, setScore]       = useState(0);
  const [best, setBest]         = useState(readBestScore);
  const [levelIndex, setLevel]  = useState(0);
  const [state, setState]       = useState('idle');

  // ── Refs (readable inside setInterval without stale-closure issues) ──────────
  const dirRef      = useRef(INIT_DIR);
  const dirQueueRef = useRef([]);

  // Ring buffer position — shared with GameCanvas (read-only from GameCanvas side)
  const headIdxRef  = useRef(0);                // index of head segment in segPool
  const snakeLenRef = useRef(INIT_SNAKE.length);// live segment count

  const foodRef     = useRef({ x: 7, y: 5 });
  const scoreRef    = useRef(0);
  const bestRef     = useRef(best);
  const levelRef    = useRef(0);
  const intervalRef       = useRef(null);
  const stateRef          = useRef('idle');
  const foodsThisLevelRef = useRef(0);                // foods eaten since last level-up / reset
  const speedRef          = useRef(LEVELS[0].speed);  // live interval delay in ms

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

  const startLoop = useCallback((lvlIdx, speed) => {
    stopLoop();
    const ms = speed ?? LEVELS[lvlIdx ?? levelRef.current].speed;
    speedRef.current    = ms;
    intervalRef.current = setInterval(() => tickRef.current?.(), ms);
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

      // Per-food speed boost: each food reduces the tick interval within the level
      foodsThisLevelRef.current += 1;
      const boostedSpeed = Math.max(
        SPEED_FLOOR,
        LEVELS[levelRef.current].speed - foodsThisLevelRef.current * SPEED_PER_FOOD
      );

      // Level-up: while loop handles jumping past multiple thresholds at once
      let lvl = levelRef.current;
      while (lvl < LEVELS.length - 1 && newScore >= LEVELS[lvl].scoreNext) lvl++;
      if (lvl !== levelRef.current) {
        levelRef.current = lvl;
        setLevel(lvl);
        foodsThisLevelRef.current = 0;  // reset per-food counter on level-up
        startLoop(lvl);                 // restarts at new level's base speed
      } else {
        startLoop(undefined, boostedSpeed);  // apply per-food boost within level
      }

      // Spawn new food at a free cell.
      // randomFood returns null only when every cell is occupied (board full).
      // In that case food stays where it is; the snake can't reach it without
      // self-collision, so no re-scoring is possible.
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
  //
  // State sync note: scoreRef/bestRef/levelRef are updated synchronously BEFORE
  // their matching setState calls. This is intentional — the canvas only reads
  // position refs (headIdxRef, snakeLenRef, foodRef), never scoreRef/levelRef.
  // Score/level state is consumed solely by non-canvas UI (Scoreboard, LevelBar)
  // which renders on the next React flush. No mismatch window exists in practice.
  //
  // tick() closes over startLoop (stable useCallback) and reads all other values
  // via refs — refs are always current so no stale closure risk.
  // exhaustive-deps would demand listing every ref object, causing tick() to be
  // recreated unnecessarily on every render. Suppressed intentionally.
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

    // Queue is capped at DIR_QUEUE_MAX (2). Inputs beyond that are dropped
    // intentionally — two buffered turns cover any legitimate play pattern
    // and prevent queue bloat from rapid key-mashing.
    if (dirQueueRef.current.length < DIR_QUEUE_MAX) {
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
      startLoop(undefined, speedRef.current);  // restore earned speed, not just base
    }
  }, [startLoop, stopLoop]);

  const reset = useCallback(() => {
    stopLoop();
    headIdxRef.current  = initPool(INIT_SNAKE);   // returns 0; fills pool
    snakeLenRef.current = INIT_SNAKE.length;
    dirRef.current      = { x: 1, y: 0 };
    dirQueueRef.current = [];
    // randomFood on a 3-segment snake has 97 free cells on a 10×10 grid — null is impossible here.
    // Fallback picks the first free cell deterministically rather than a hardcoded
    // coordinate that could coincide with the snake if INIT_SNAKE ever changes.
    const initFood = randomFood(headIdxRef.current, snakeLenRef.current);
    if (!initFood) {
      // Should never happen; guard against future INIT_SNAKE changes.
      const occupied = new Set(INIT_SNAKE.map(s => `${s.x},${s.y}`));
      for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
          if (!occupied.has(`${x},${y}`)) { foodRef.current = { x, y }; break; }
        }
        if (foodRef.current !== undefined) break;
      }
    } else {
      foodRef.current = initFood;
    }
    scoreRef.current          = 0;
    levelRef.current          = 0;
    stateRef.current          = 'idle';
    foodsThisLevelRef.current = 0;
    speedRef.current          = LEVELS[0].speed;
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
    // Track whether the pause was triggered automatically by a tab hide,
    // so the resume on tab restore only undoes auto-pauses (not manual ones).
    let autoPaused = false;
    const onVisibility = () => {
      if (document.hidden) {
        if (stateRef.current === 'running') {
          stopLoop();
          stateRef.current = 'paused';
          setState('paused');
          autoPaused = true;
        }
      } else {
        if (autoPaused && stateRef.current === 'paused') {
          autoPaused = false;
          stateRef.current = 'running';
          setState('running');
          startLoop(undefined, speedRef.current);  // restore earned speed on tab restore
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stopLoop, startLoop]);

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
