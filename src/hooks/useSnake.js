/**
 * useSnake — the complete game engine.
 *
 * This hook is the single source of truth for all game state and logic.
 * It owns the tick loop, state machine, input queue, and side effects.
 * No component is allowed to mutate game state directly.
 *
 * Returns:
 *   snake       {x,y}[]   — ordered segment list, head at index 0
 *   food        {x,y}     — current food position
 *   score       number    — current score
 *   best        number    — all-time best (persisted in localStorage)
 *   levelIndex  number    — current level index into LEVELS (0–4)
 *   state       string    — 'idle' | 'running' | 'paused' | 'dead'
 *   applyDir    function  — queue a new direction ({x,y})
 *   pause       function  — toggle pause/resume
 *   reset       function  — restart the game from scratch
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { COLS, ROWS, LEVELS } from '../constants';

// ─── Initial values ───────────────────────────────────────────────────────────
// Defined outside the hook so they are stable references and never recreated.
const INIT_SNAKE = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
const INIT_DIR   = { x: 1, y: 0 };  // starts moving right

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pick a random grid cell not occupied by the snake.
 * Includes an iteration cap so a nearly-full board can't loop forever.
 */
function randomFood(snake) {
  let pos;
  let attempts = 0;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    attempts++;
  } while (attempts < 1000 && snake.some(s => s.x === pos.x && s.y === pos.y));
  // Return null if the board is too full to find a free cell after 1000 tries.
  // Caller must handle null (keeps existing food in place).
  if (snake.some(s => s.x === pos.x && s.y === pos.y)) return null;
  return pos;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSnake() {

  // ── React state (drives UI re-renders) ──────────────────────────────────────
  const [snake, setSnake]       = useState(INIT_SNAKE);
  const [food, setFood]         = useState({ x: 15, y: 10 });
  const [score, setScore]       = useState(0);
  const [best, setBest]         = useState(
    // Lazy initializer: reads localStorage only on first render.
    // try-catch guards against SecurityError in private browsing / iframes.
    () => { try { return parseInt(localStorage.getItem('snakeBest') || '0'); } catch { return 0; } }
  );
  const [levelIndex, setLevel]  = useState(0);
  const [state, setState]       = useState('idle'); // 'idle'|'running'|'paused'|'dead'

  // ── Refs (readable inside setInterval without stale-closure issues) ──────────
  // Each piece of mutable game data is mirrored in a ref so tick() always
  // sees the current value regardless of when the closure was created.
  const dirRef      = useRef(INIT_DIR);       // direction applied on last tick
  const dirQueueRef = useRef([]);             // buffered upcoming directions (max 2)
  const snakeRef    = useRef(INIT_SNAKE);
  const foodRef     = useRef({ x: 15, y: 10 });
  const scoreRef    = useRef(0);
  const bestRef     = useRef((() => { try { return parseInt(localStorage.getItem('snakeBest') || '0'); } catch { return 0; } })());
  const levelRef    = useRef(0);
  const intervalRef = useRef(null);           // ID returned by setInterval
  const stateRef    = useRef('idle');

  // tickRef holds a reference to the latest tick callback.
  // startLoop's setInterval calls tickRef.current() instead of tick() directly.
  // This breaks the circular useCallback dependency:
  //   tick → depends on startLoop
  //   startLoop → would depend on tick  ← broken via this ref
  const tickRef = useRef(null);

  // ── Loop control ─────────────────────────────────────────────────────────────

  /** Clear the running interval. Safe to call even if no interval is active. */
  const stopLoop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /**
   * Start (or restart) the game loop at the speed of the given level.
   * Always clears any existing interval first to avoid duplicates.
   * @param {number} lvlIdx  Index into LEVELS; defaults to levelRef.current.
   */
  const startLoop = useCallback((lvlIdx) => {
    stopLoop();
    intervalRef.current = setInterval(
      () => tickRef.current?.(),   // always calls the freshest tick
      LEVELS[lvlIdx ?? levelRef.current].speed
    );
  }, [stopLoop]);

  // ── Core tick ─────────────────────────────────────────────────────────────────

  /**
   * Called every N ms by setInterval. One tick = one grid step.
   *
   * Steps:
   *  1. Consume the next queued direction (reject 180° reversals).
   *  2. Compute new head position.
   *  3. Collision checks (wall, self) → die().
   *  4. Build new snake array (prepend head).
   *  5. Food check:
   *     - YES: score, best, level-up, new food  (tail kept → grows)
   *     - NO:  remove tail                       (length stays the same)
   *  6. Sync ref + React state.
   */
  const tick = useCallback(() => {
    // 1. Dequeue next direction, validating against current direction
    if (dirQueueRef.current.length > 0) {
      const next = dirQueueRef.current.shift();
      const cur  = dirRef.current;
      // Reject if it would reverse 180° (e.g. moving right, trying to go left)
      if (!(next.x === -cur.x && next.y === -cur.y)) {
        dirRef.current = next;
      }
    }

    // 2. New head = current head + direction vector
    const head = {
      x: snakeRef.current[0].x + dirRef.current.x,
      y: snakeRef.current[0].y + dirRef.current.y,
    };

    // 3a. Wall collision
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      return die();
    }
    // 3b. Self collision (head lands on any existing segment)
    if (snakeRef.current.some(s => s.x === head.x && s.y === head.y)) {
      return die();
    }

    // 4. Prepend new head (tail removal happens below if no food was eaten)
    const newSnake = [head, ...snakeRef.current];
    const ate = head.x === foodRef.current.x && head.y === foodRef.current.y;

    if (ate) {
      // 5a. Ate food: grow, update score, possibly level-up
      const newScore = scoreRef.current + 10;
      scoreRef.current = newScore;
      setScore(newScore);

      if (newScore > bestRef.current) {
        bestRef.current = newScore;
        setBest(newScore);
        // Persist new best — guarded against SecurityError in private browsing
        try { localStorage.setItem('snakeBest', String(newScore)); } catch { /* ignored */ }
      }

      // Level-up: advance through levels while score meets threshold
      let lvl = levelRef.current;
      while (lvl < LEVELS.length - 1 && newScore >= LEVELS[lvl].scoreNext) lvl++;
      if (lvl !== levelRef.current) {
        levelRef.current = lvl;
        setLevel(lvl);
        startLoop(lvl);   // restart loop at the new (faster) speed
      }

      // Spawn new food at a free cell.
      // randomFood returns null when the board is nearly full — keep current food.
      const newFood = randomFood(newSnake);
      if (newFood) {
        foodRef.current = newFood;
        setFood(newFood);
      }
      // Tail is NOT removed → snake is longer by 1
    } else {
      // 5b. No food: remove tail segment (snake moves forward, same length)
      newSnake.pop();
    }

    // 6. Commit new snake to both ref (for next tick) and state (for render)
    snakeRef.current = newSnake;
    setSnake([...newSnake]);
  }, [startLoop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep tickRef pointing to the latest tick after every render
  tickRef.current = tick;

  // ── State machine actions ─────────────────────────────────────────────────────

  /** Transition to 'dead' state. Stops the loop. */
  const die = useCallback(() => {
    stopLoop();
    stateRef.current = 'dead';
    setState('dead');
  }, [stopLoop]);

  /**
   * Queue a new direction.
   * - Validates against the last queued direction (not current) to correctly
   *   handle rapid multi-step inputs.
   * - Caps the queue at 2 to prevent over-buffering.
   * - Transitions idle → running on first input.
   */
  const applyDir = useCallback((newDir) => {
    // Compare against last queued direction so we don't reject valid moves
    const last = dirQueueRef.current.length > 0
      ? dirQueueRef.current[dirQueueRef.current.length - 1]
      : dirRef.current;

    if (newDir.x === -last.x && newDir.y === -last.y) return; // 180° flip
    if (newDir.x === last.x  && newDir.y === last.y)  return; // duplicate

    if (dirQueueRef.current.length < 2) {
      dirQueueRef.current.push(newDir);
    }

    // First keypress starts the game
    if (stateRef.current === 'idle') {
      stateRef.current = 'running';
      setState('running');
      startLoop(levelRef.current);
    }
  }, [startLoop]);

  /** Toggle between running ↔ paused. No-op in other states. */
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

  /** Reset everything to initial values. Returns to 'idle' state. */
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

  // ── Side effects ──────────────────────────────────────────────────────────────

  // Keyboard input
  useEffect(() => {
    const keyMap = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
      a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    };
    const onKey = (e) => {
      if (e.key === 'p' || e.key === 'P') { pause(); return; }
      // Enter or Space restarts the game after death
      if ((e.key === 'Enter' || e.key === ' ') && stateRef.current === 'dead') {
        reset(); return;
      }
      const dir = keyMap[e.key];
      if (!dir) return;
      e.preventDefault(); // prevent arrow keys from scrolling the page
      applyDir(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyDir, pause, reset]);

  // Auto-pause when the user switches away from the tab
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

  // Clean up interval when the component unmounts
  useEffect(() => {
    return () => stopLoop();
  }, [stopLoop]);

  // ── Public API ────────────────────────────────────────────────────────────────
  return { snake, food, score, best, levelIndex, state, applyDir, pause, reset };
}
