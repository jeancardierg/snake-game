/**
 * useSnake — the complete game engine.
 *
 * This hook is the single source of truth for all game state and logic.
 * It owns the tick loop, state machine, input queue, and side effects.
 * No component is allowed to mutate game state directly.
 *
 * Returns:
 *   headIdxRef   React.MutableRefObject<number>  — pool head index (for GameCanvas)
 *   snakeLenRef  React.MutableRefObject<number>  — live segment count (for GameCanvas)
 *   foodRef      React.MutableRefObject<{x,y}>   — current food position (for GameCanvas)
 *   obstaclesRef React.MutableRefObject<{set,cells}> — current level's walls (for GameCanvas)
 *   score       number    — current score
 *   best        number    — all-time best (persisted in localStorage)
 *   levelIndex  number    — current level index (unbounded; see levels.js)
 *   state       string    — 'idle' | 'running' | 'paused' | 'dead'
 *   banner      object    — transient level-up announcement, or null
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
import { COLS, ROWS, DIR_QUEUE_MAX, SPEED_PER_FOOD, SPEED_FLOOR } from '../constants';
import { getLevel } from '../levels';
import { POOL_SIZE, segPool, initPool, poolPrepend, poolGet } from '../pool';
import { playStart, playEat, playLevelUp, playDeath } from '../audio';
import { startMusic, stopMusic, pauseMusic, resumeMusic } from '../music';

// ─── Initial values ───────────────────────────────────────────────────────────
// NOTE: levels.js reserves SPAWN_ROW / SPAWN_RUNWAY_X from obstacle placement
// based on these values — keep the two in sync.
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
    // Validate the parsed value. A corrupt/non-numeric stored value must not
    // poison `best` with NaN: it would render as "NaN" and, because
    // `newScore > NaN` is always false, permanently block best-score updates
    // for the session. Reject anything that isn't a finite, non-negative number.
    const n = parseInt(localStorage.getItem('snakeBest'), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
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
 * Read an optional `?level=N` override from the URL.
 *
 * Development/QA aid: jumping straight to a level is the only practical way to
 * eyeball a late-game theme, layout or track. Parsed defensively — anything
 * that is not a finite non-negative integer is ignored.
 */
function readStartLevel() {
  try {
    const raw = new URLSearchParams(window.location.search).get('level');
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Pick a random free grid cell not occupied by the snake or an obstacle.
 *
 * O(n) implementation: build a Set of occupied cells once, then sample
 * from the list of free cells directly. Avoids the O(n²) retry loop that
 * the previous random-probe approach caused on large snakes.
 *
 * Returns null only when every cell is occupied (board full = game won).
 * Caller is responsible for handling null without moving the food.
 */
function randomFood(headIdx, snakeLen, obstacles) {
  // Build occupied set in one pass
  const occupied = new Set(obstacles);
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
  const cell = free[Math.floor(Math.random() * free.length)];
  return { ...cell };
}

// Starting level. Constant for the lifetime of the page (the URL cannot change
// without a reload), so it is read once here rather than per hook instance.
const START_LEVEL = readStartLevel();

// How long the level-up announcement stays on screen.
const BANNER_MS = 1600;

/** Build the {set, cells} obstacle record for a level, minus any excluded cells. */
export function buildObstacles(lvl, excluded) {
  const set   = new Set();
  const cells = [];
  for (const c of getLevel(lvl).obstacles) {
    const key = c.x * ROWS + c.y;
    if (excluded?.has(key)) continue;
    set.add(key);
    cells.push(c);
  }
  return { set, cells };
}

/** How many cells ahead of the head are kept clear of a mid-run wall drop. */
export const LOOKAHEAD = 2;

/**
 * Cells a new level's obstacles must not be dropped onto, given a board that is
 * already in play:
 *   - every cell the snake occupies (it would end up inside a wall)
 *   - the cell holding the current food (it would become unreachable)
 *   - the LOOKAHEAD cells directly ahead of the head (an unavoidable death)
 *
 * Off-board look-ahead cells produce keys no obstacle can match, so no bounds
 * check is needed. Exported for tests — the fairness of a mid-run layout swap
 * rests entirely on this set.
 */
export function spawnExclusions(headIdx, snakeLen, dir, food) {
  const excluded = new Set();

  for (let i = 0; i < snakeLen; i++) {
    const s = segPool[(headIdx + i) % POOL_SIZE];
    excluded.add(s.x * ROWS + s.y);
  }

  const head = poolGet(headIdx, 0);
  for (let k = 1; k <= LOOKAHEAD; k++) {
    excluded.add((head.x + dir.x * k) * ROWS + (head.y + dir.y * k));
  }

  if (food) excluded.add(food.x * ROWS + food.y);

  return excluded;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSnake() {

  // ── React state (drives non-canvas UI re-renders) ───────────────────────────
  // snake and food are intentionally NOT state — GameCanvas reads refs directly.
  const [score, setScore]       = useState(0);
  const [best, setBest]         = useState(readBestScore);
  const [levelIndex, setLevel]  = useState(START_LEVEL);
  const [state, setState]       = useState('idle');
  // Transient level-up announcement. Owned here rather than derived in App from
  // a levelIndex change, because only this hook knows when an advance actually
  // happened — a reset back to the same index must not re-announce it.
  const [banner, setBanner]     = useState(null);
  const bannerTimerRef          = useRef(null);

  // ── Refs (readable inside setInterval without stale-closure issues) ──────────
  const dirRef      = useRef(INIT_DIR);
  const dirQueueRef = useRef([]);

  // Ring buffer position — shared with GameCanvas (read-only from GameCanvas side)
  const headIdxRef  = useRef(0);                // index of head segment in segPool
  const snakeLenRef = useRef(INIT_SNAKE.length);// live segment count

  // (7,5) sits on the reserved spawn row, so it can never collide with an obstacle.
  const foodRef     = useRef({ x: 7, y: 5 });
  const scoreRef    = useRef(0);
  const bestRef     = useRef(best);
  const levelRef    = useRef(START_LEVEL);
  const intervalRef       = useRef(null);
  const stateRef          = useRef('idle');
  const foodsThisLevelRef = useRef(0);                            // foods eaten since last level-up / reset
  const speedRef          = useRef(getLevel(START_LEVEL).speed);  // live interval delay in ms

  // Current level's obstacle layout: a Set of x*ROWS+y keys for O(1) collision
  // checks, plus the matching cell list for GameCanvas to render.
  // useRef has no lazy initialiser, so seed it on the first render instead —
  // this must be populated before the first tick, and reset() is not called on mount.
  const obstaclesRef = useRef(null);
  if (obstaclesRef.current === null) obstaclesRef.current = buildObstacles(START_LEVEL);

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
    const ms = speed ?? getLevel(lvlIdx ?? levelRef.current).speed;
    speedRef.current    = ms;
    intervalRef.current = setInterval(() => tickRef.current?.(), ms);
  }, [stopLoop]);

  /** Install a level's obstacle layout, honouring the mid-run spawn exclusions. */
  const applyLevelObstacles = useCallback((lvl) => {
    obstaclesRef.current = buildObstacles(lvl, spawnExclusions(
      headIdxRef.current, snakeLenRef.current, dirRef.current, foodRef.current,
    ));
  }, []);

  /** Show the level-up banner for BANNER_MS, replacing any banner already up. */
  const announceLevel = useCallback((lvl) => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setBanner(getLevel(lvl));
    bannerTimerRef.current = setTimeout(() => {
      bannerTimerRef.current = null;
      setBanner(null);
    }, BANNER_MS);
  }, []);

  const clearBanner = useCallback(() => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    setBanner(null);
  }, []);

  // ── State machine actions ─────────────────────────────────────────────────────
  // die() is declared before tick() so tick() can call it without a forward reference.

  const die = useCallback(() => {
    stopLoop();
    stateRef.current = 'dead';
    setState('dead');
    stopMusic();
    clearBanner();
    playDeath();
  }, [stopLoop, clearBanner]);

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

    // 3b. Obstacle collision — the level's generated layout is fatal like a wall
    if (obstaclesRef.current.set.has(hx * ROWS + hy)) {
      return die();
    }

    // 3c. Self collision — check body segments before prepend.
    // Skip index 0 (the current head — the moved head can never equal it) and,
    // when the snake is NOT eating, skip the tail: it vacates its cell on this
    // same tick, so moving the head into the old tail cell is legal (canonical
    // Snake). When eating, the tail stays put, so the full body is checked.
    const snakeLen = snakeLenRef.current;
    const willEat  = hx === foodRef.current.x && hy === foodRef.current.y;
    const checkLen = willEat ? snakeLen : snakeLen - 1;
    for (let i = 1; i < checkLen; i++) {
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

    const ate = willEat;  // computed above for the self-collision check; food hasn't moved since

    if (ate) {
      playEat();
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
        getLevel(levelRef.current).speed - foodsThisLevelRef.current * SPEED_PER_FOOD
      );

      // Level-up: while loop handles jumping past multiple thresholds at once.
      // There is no final level — scoreNext is strictly increasing, so the loop
      // always terminates once the score falls below the next threshold.
      let lvl = levelRef.current;
      while (newScore >= getLevel(lvl).scoreNext) lvl++;
      if (lvl !== levelRef.current) {
        levelRef.current = lvl;
        // Obstacles must be installed before the new food is placed below,
        // otherwise food can spawn inside a freshly added wall.
        applyLevelObstacles(lvl);
        setLevel(lvl);
        announceLevel(lvl);
        playLevelUp();
        startMusic(getLevel(lvl).music);
        foodsThisLevelRef.current = 0;  // reset per-food counter on level-up
        startLoop(lvl);                 // restarts at new level's base speed
      } else {
        startLoop(undefined, boostedSpeed);  // apply per-food boost within level
      }

      // Spawn new food at a free cell.
      // randomFood returns null only when every cell is occupied (board full).
      // In that case food stays where it is; the snake can't reach it without
      // self-collision, so no re-scoring is possible.
      const newFood = randomFood(headIdxRef.current, snakeLenRef.current, obstaclesRef.current.set);
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
  // tick() closes over startLoop and applyLevelObstacles (both stable
  // useCallbacks) and reads all other values via refs — refs are always current
  // so no stale closure risk.
  // exhaustive-deps would demand listing every ref object, causing tick() to be
  // recreated unnecessarily on every render. Suppressed intentionally.
  }, [startLoop, applyLevelObstacles, announceLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep tickRef pointing to the latest tick after every render.
  // useLayoutEffect runs synchronously after DOM mutations, before paint,
  // ensuring the interval always calls the most-recent tick closure.
  useLayoutEffect(() => { tickRef.current = tick; });

  const applyDir = useCallback((newDir) => {
    // Any press starts the game from idle — must run before direction filters
    // so that LEFT and RIGHT (filtered as 180°/same relative to INIT_DIR) still work.
    if (stateRef.current === 'idle') {
      stateRef.current = 'running';
      setState('running');
      playStart();
      // This call is inside a real user gesture, which is what unblocks the
      // AudioContext under browser autoplay policy — music must start here.
      startMusic(getLevel(levelRef.current).music);
      startLoop(levelRef.current);
    }

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
  }, [startLoop]);

  const pause = useCallback(() => {
    if (stateRef.current === 'running') {
      stopLoop();
      stateRef.current = 'paused';
      setState('paused');
      pauseMusic();
    } else if (stateRef.current === 'paused') {
      stateRef.current = 'running';
      setState('running');
      resumeMusic();
      startLoop(undefined, speedRef.current);  // restore earned speed, not just base
    }
  }, [startLoop, stopLoop]);

  const reset = useCallback(() => {
    stopLoop();
    stopMusic();
    clearBanner();
    headIdxRef.current  = initPool(INIT_SNAKE);   // returns 0; fills pool
    snakeLenRef.current = INIT_SNAKE.length;
    dirRef.current      = { x: 1, y: 0 };
    dirQueueRef.current = [];
    // Fresh board: take the level's layout as generated (it already reserves the
    // spawn row), then place food clear of both the snake and the obstacles.
    obstaclesRef.current = buildObstacles(START_LEVEL);
    // A 3-segment snake on a 10×10 grid with at most MAX_OBSTACLES walls leaves
    // plenty of free cells, so randomFood is never null here (it returns null
    // only when the whole board is occupied).
    foodRef.current = randomFood(headIdxRef.current, snakeLenRef.current, obstaclesRef.current.set);
    scoreRef.current          = 0;
    levelRef.current          = START_LEVEL;
    stateRef.current          = 'idle';
    foodsThisLevelRef.current = 0;
    speedRef.current          = getLevel(START_LEVEL).speed;
    setScore(0);
    setLevel(START_LEVEL);
    setState('idle');
  }, [stopLoop, clearBanner]);

  // ── Side effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    // Prototype-free map so a key such as "__proto__" / "constructor" /
    // "toString" can't resolve to an inherited Object property and slip a
    // non-direction object past the `if (!dir) return` guard. Defensive only:
    // real keyboards never emit those as event.key, but a synthetic event could.
    const keyMap = Object.assign(Object.create(null), {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
      a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    });
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
          pauseMusic();
          autoPaused = true;
        }
      } else {
        if (autoPaused && stateRef.current === 'paused') {
          autoPaused = false;
          stateRef.current = 'running';
          setState('running');
          resumeMusic();
          startLoop(undefined, speedRef.current);  // restore earned speed on tab restore
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stopLoop, startLoop]);

  useEffect(() => {
    return () => {
      stopLoop();
      stopMusic();   // the scheduler interval outlives the component otherwise
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [stopLoop]);

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    // Refs for GameCanvas (read directly, no React round-trip)
    headIdxRef, snakeLenRef, foodRef, obstaclesRef,
    // React state for non-canvas UI
    score, best, levelIndex, state, banner,
    // Actions
    applyDir, pause, reset,
  };
}
