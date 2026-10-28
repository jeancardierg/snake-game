/**
 * useSnake — the complete game engine.
 *
 * This hook is the single source of truth for all game state and logic.
 * It owns the tick loop, state machine, input queue, and side effects.
 * No component is allowed to mutate game state directly.
 *
 * Options:
 *   turnSteering boolean — the camera turns with the snake (Chase cam), so
 *                          left/right turn the snake relative to its heading
 *                          and up/down only start the game
 *
 * Returns:
 *   headIdxRef   React.MutableRefObject<number>  — pool head index (for GameCanvas)
 *   snakeLenRef  React.MutableRefObject<number>  — live segment count (for GameCanvas)
 *   foodRef      React.MutableRefObject<{x,y}>   — current food position (for GameCanvas)
 *   obstaclesRef React.MutableRefObject<{set,cells}> — current level's walls (for GameCanvas)
 *   score       number    — current score
 *   best        number    — all-time best for the current mode (persisted in localStorage)
 *   levelIndex  number    — current level index (unbounded; see levels.js)
 *   state       string    — 'idle' | 'running' | 'paused' | 'dead'
 *   banner      object    — transient level-up announcement, or null
 *   wrap        boolean   — wrap-around mode: the head leaves one edge and
 *                           re-enters from the opposite one instead of dying
 *   applyDir    function  — queue a new direction ({x,y})
 *   steer       function  — player input ({x,y} screen direction); with
 *                           turnSteering, left/right turn relative to the head
 *   pause       function  — toggle pause/resume
 *   reset       function  — restart the game from scratch
 *   toggleWrap  function  — flip wrap mode (no-op unless idle or dead)
 *   autopilot   boolean   — the snake steers itself (see autopilot.js)
 *   assisted    boolean   — autopilot steered at some point this run, so the
 *                           run does not count toward best
 *   toggleAutopilot function — flip autopilot; turning it on from idle starts
 *                           the run. Player steering mid-run takes back control.
 *
 * Rendering decoupling:
 *   snake and food are no longer returned as React state. Instead, headIdxRef,
 *   snakeLenRef, and foodRef are refs that GameCanvas reads directly inside a
 *   requestAnimationFrame loop — eliminating React reconciliation on every tick.
 *   score, best, levelIndex, and state remain as React state because they drive
 *   non-canvas UI (Scoreboard, LevelBar, Overlay, buttons).
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { COLS, ROWS, DIR_QUEUE_MAX } from '../constants';
import { getLevel, speedAfterFoods, SPAWN_ROW, SPAWN_HEAD_X, SPAWN_RUNWAY_X } from '../levels';
import { POOL_SIZE, segPool, initPool, poolPrepend, poolGet } from '../pool';
import { playStart, playEat, playLevelUp, playDeath } from '../audio';
import { startMusic, stopMusic, pauseMusic, resumeMusic } from '../music';
import { autopilotDir } from '../autopilot';
import { markInput, markQueued, markDequeued, clearQueued } from '../inputDebug';

// ─── Initial values ───────────────────────────────────────────────────────────
// Built from the spawn constants in levels.js, which reserve this row and the
// runway ahead of the head from obstacle placement — one source of truth.
// On 10×10: (5,5),(4,5),(3,5).
const INIT_SNAKE = [0, 1, 2].map(i => ({ x: SPAWN_HEAD_X - i, y: SPAWN_ROW }));
const INIT_DIR   = { x: 1, y: 0 };  // starts moving right

// Seed the pool with the initial snake on module load.
// reset() re-seeds on every game restart.
initPool(INIT_SNAKE);

// ─── Mode persistence ─────────────────────────────────────────────────────────
// Best scores are tracked per mode (wrap-around is easier than classic, so a
// shared record would be unfair) and per board size: a record set on a smaller
// board is not comparable, so changing COLS/ROWS starts fresh records. The
// 10×10-era keys ('snakeBest', 'snakeBestWrap') are retired on load.
const WRAP_KEY = 'snakeWrap';
const GRID_TAG = `${COLS}x${ROWS}`;
export function bestKey(wrap) { return `${wrap ? 'snakeBestWrap' : 'snakeBest'}_${GRID_TAG}`; }
export const LEGACY_BEST_KEYS = ['snakeBest', 'snakeBestWrap'];

/** Remove best-score keys from before records were per board size. Never throws. */
export function retireLegacyBestScores() {
  try {
    for (const k of LEGACY_BEST_KEYS) localStorage.removeItem(k);
  } catch { /* storage unavailable — nothing to retire */ }
}

/** Read the persisted mode. Classic (false) unless wrap was explicitly chosen. */
function readWrap() {
  try {
    return localStorage.getItem(WRAP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Read the persisted best score for one mode from localStorage.
 * Logs a warning (never throws) when storage is unavailable.
 */
function readBestScore(key) {
  try {
    // Validate the parsed value. A corrupt/non-numeric stored value must not
    // poison `best` with NaN: it would render as "NaN" and, because
    // `newScore > NaN` is always false, permanently block best-score updates
    // for the session. Reject anything that isn't a finite, non-negative number.
    const n = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    console.warn('[useSnake] localStorage unavailable:', e.message);
    return 0;
  }
}
// Note: best score and mode are intentionally NOT read here at module load.
// useState uses lazy initializers so they run on the hook's first render — this
// ensures localStorage is read fresh for each hook instance (critical for test
// isolation and React Strict Mode).

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

// Monotonic across the whole session, so a renderer comparing versions can never
// mistake a new record (level-up, reset) for the one it already drew.
let obstacleVersion = 0;

/**
 * Build the obstacle record for a level.
 *
 *   set     — keys (x*ROWS+y) of walls in play, for O(1) collision checks
 *   cells   — the same walls as {x,y}, for GameCanvas
 *   pending — layout cells that could not be placed yet because they were in
 *             `excluded` (under the snake, on the food, right ahead of the head).
 *             placePendingObstacles() drops them in once they are clear, so a
 *             level-up mid-run no longer loses part of its layout for good.
 *   version — bumped on every change; GameCanvas re-syncs when it differs
 */
export function buildObstacles(lvl, excluded) {
  const set     = new Set();
  const cells   = [];
  const pending = [];
  for (const c of getLevel(lvl).obstacles) {
    const key = c.x * ROWS + c.y;
    if (excluded?.has(key)) { pending.push(c); continue; }
    set.add(key);
    cells.push(c);
  }
  return { set, cells, pending, version: ++obstacleVersion };
}

/**
 * Move every pending obstacle cell that is now clear into play.
 * Uses the same exclusion rules as a level-up, so a wall never appears under the
 * snake, on the food, or inside the look-ahead in front of the head.
 *
 * Safe for reachability: the full layout was validated reachable from spawn,
 * and any subset of it has strictly fewer walls.
 *
 * Mutates `record` in place. Returns true when anything was placed.
 */
export function placePendingObstacles(record, headIdx, snakeLen, dir, food, wrap = false) {
  if (!record.pending?.length) return false;
  const blocked = spawnExclusions(headIdx, snakeLen, dir, food, wrap);
  // A wall popping in beside the head could kill a turn the player has already
  // queued, so mid-run placement also keeps every cell within HEAD_CLEARANCE
  // steps of the head clear — not just the straight line ahead.
  const head = poolGet(headIdx, 0);
  for (let dx = -HEAD_CLEARANCE; dx <= HEAD_CLEARANCE; dx++) {
    for (let dy = -HEAD_CLEARANCE; dy <= HEAD_CLEARANCE; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > HEAD_CLEARANCE) continue;
      let x = head.x + dx;
      let y = head.y + dy;
      if (wrap) {
        x = ((x % COLS) + COLS) % COLS;
        y = ((y % ROWS) + ROWS) % ROWS;
      } else if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
      blocked.add(x * ROWS + y);
    }
  }
  const still   = [];
  for (const c of record.pending) {
    const key = c.x * ROWS + c.y;
    if (blocked.has(key)) { still.push(c); continue; }
    record.set.add(key);
    record.cells.push(c);
  }
  if (still.length === record.pending.length) return false;
  record.pending = still;
  record.version = ++obstacleVersion;
  return true;
}

/** How many cells ahead of the head are kept clear of a mid-run wall drop. */
export const LOOKAHEAD = 2;

/** Manhattan radius around the head kept clear when a deferred wall is placed. */
export const HEAD_CLEARANCE = 2;

/**
 * Cells a new level's obstacles must not be dropped onto, given a board that is
 * already in play:
 *   - every cell the snake occupies (it would end up inside a wall)
 *   - the cell holding the current food (it would become unreachable)
 *   - the LOOKAHEAD cells directly ahead of the head (an unavoidable death)
 *
 * Off-board look-ahead cells produce keys no obstacle can match, so no bounds
 * check is needed in classic mode. In wrap mode the head continues onto the
 * opposite edge, so the look-ahead wraps with it — otherwise a wall could drop
 * directly behind the portal. Exported for tests — the fairness of a mid-run
 * layout swap rests entirely on this set.
 */
export function spawnExclusions(headIdx, snakeLen, dir, food, wrap = false) {
  const excluded = new Set();

  for (let i = 0; i < snakeLen; i++) {
    const s = segPool[(headIdx + i) % POOL_SIZE];
    excluded.add(s.x * ROWS + s.y);
  }

  const head = poolGet(headIdx, 0);
  for (let k = 1; k <= LOOKAHEAD; k++) {
    let x = head.x + dir.x * k;
    let y = head.y + dir.y * k;
    if (wrap) {
      x = ((x % COLS) + COLS) % COLS;
      y = ((y % ROWS) + ROWS) % ROWS;
    }
    excluded.add(x * ROWS + y);
  }

  if (food) excluded.add(food.x * ROWS + food.y);

  return excluded;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSnake({ turnSteering = false } = {}) {

  // ── React state (drives non-canvas UI re-renders) ───────────────────────────
  // snake and food are intentionally NOT state — GameCanvas reads refs directly.
  const [score, setScore]       = useState(0);
  const [wrap, setWrap]         = useState(readWrap);
  const [best, setBest]         = useState(() => {
    retireLegacyBestScores();
    return readBestScore(bestKey(wrap));
  });
  const [levelIndex, setLevel]  = useState(START_LEVEL);
  const [state, setState]       = useState('idle');
  // Transient level-up announcement. Owned here rather than derived in App from
  // a levelIndex change, because only this hook knows when an advance actually
  // happened — a reset back to the same index must not re-announce it.
  const [banner, setBanner]     = useState(null);
  const bannerTimerRef          = useRef(null);
  // Autopilot is session-only (never persisted). `assisted` marks a run it
  // steered, at any point: such a run never writes a best score.
  const [autopilot, setAutopilot] = useState(false);
  const [assisted, setAssisted]   = useState(false);
  const autopilotRef = useRef(false);
  const assistedRef  = useRef(false);

  // ── Refs (readable inside setInterval without stale-closure issues) ──────────
  const dirRef      = useRef(INIT_DIR);
  const dirQueueRef = useRef([]);

  // Ring buffer position — shared with GameCanvas (read-only from GameCanvas side)
  const headIdxRef  = useRef(0);                // index of head segment in segPool
  const snakeLenRef = useRef(INIT_SNAKE.length);// live segment count

  // The end of the reserved runway, so it can never collide with an obstacle.
  // On 10×10: (7,5).
  const foodRef     = useRef({ x: SPAWN_RUNWAY_X, y: SPAWN_ROW });
  const scoreRef    = useRef(0);
  const bestRef     = useRef(best);
  const wrapRef     = useRef(wrap);
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
      wrapRef.current,
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
   *  2. Compute new head position (wrapped onto the opposite edge in wrap mode).
   *  3. Collision checks (wall — classic mode only, obstacle, self) → die().
   *  4. Prepend new head into ring buffer (in-place, zero allocation).
   *  5. Food check:
   *     - YES: score, best, level-up, new food  (tail kept → grows)
   *     - NO:  shrink snakeLen by 1             (tail "popped" by not counting it)
   *  6. Place any deferred walls whose cells are now clear.
   *  7. No setState for snake/food — GameCanvas reads refs directly via rAF.
   */
  const tick = useCallback(() => {
    // 1. Dequeue next direction — or let the autopilot choose it
    if (autopilotRef.current) {
      if (!assistedRef.current) { assistedRef.current = true; setAssisted(true); }
      const body = [];
      for (let i = 0; i < snakeLenRef.current; i++) {
        const s = poolGet(headIdxRef.current, i);
        body.push({ x: s.x, y: s.y });
      }
      dirQueueRef.current = [];
      clearQueued();
      dirRef.current = autopilotDir({
        body, dir: dirRef.current, food: foodRef.current,
        obstacles: obstaclesRef.current.set, wrap: wrapRef.current,
      });
    } else if (dirQueueRef.current.length > 0) {
      const next = dirQueueRef.current.shift();
      markDequeued();
      const cur  = dirRef.current;
      if (!(next.x === -cur.x && next.y === -cur.y)) {
        dirRef.current = next;
      }
    }

    // 2. New head = current head + direction vector
    const curHead = poolGet(headIdxRef.current, 0);
    let hx = curHead.x + dirRef.current.x;
    let hy = curHead.y + dirRef.current.y;

    // 3a. Board edge: wrap mode teleports to the opposite edge (a single step
    // can overshoot by at most one cell, so +COLS/+ROWS keeps % non-negative);
    // classic mode treats the edge as a wall.
    if (wrapRef.current) {
      hx = (hx + COLS) % COLS;
      hy = (hy + ROWS) % ROWS;
    } else if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS) {
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

      if (!assistedRef.current && newScore > bestRef.current) {
        bestRef.current = newScore;
        setBest(newScore);
        try { localStorage.setItem(bestKey(wrapRef.current), String(newScore)); } catch (e) { console.warn('[useSnake] localStorage write failed:', e.message); }
      }

      // Per-food speed ramp: each food shortens the tick a little within the level
      // (relative and capped; see speedAfterFoods / SPEED_RAMP_* in constants.js)
      foodsThisLevelRef.current += 1;
      const boostedSpeed = speedAfterFoods(levelRef.current, foodsThisLevelRef.current);

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
      // Prefer cells that are not waiting for a pending wall, so the wall is not
      // blocked by the food; fall back to any free cell when that is all there is.
      const ob = obstaclesRef.current;
      const newFood =
        (ob.pending?.length > 0 &&
          randomFood(headIdxRef.current, snakeLenRef.current,
            [...ob.set, ...ob.pending.map(c => c.x * ROWS + c.y)])) ||
        randomFood(headIdxRef.current, snakeLenRef.current, ob.set);
      if (newFood) {
        foodRef.current = newFood;
      }
      // Tail is NOT shrunk → snake is longer by 1
    } else {
      // 5b. No food: pop tail by shrinking length (object stays in pool, no GC)
      snakeLenRef.current--;
    }

    // 6. Drop in any of this level's walls that were held back at level-up
    // because the snake or food was on them, now that their cell is clear.
    placePendingObstacles(
      obstaclesRef.current, headIdxRef.current, snakeLenRef.current,
      dirRef.current, foodRef.current, wrapRef.current,
    );

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
      markQueued();
    }
  }, [startLoop]);

  // Steering mode for the current camera, read by steer() at input time.
  const turnRef = useRef(turnSteering);
  useLayoutEffect(() => { turnRef.current = turnSteering; }, [turnSteering]);

  /**
   * Player input. Screen directions go straight to applyDir; with turn
   * steering, left/right rotate the latest queued heading (grid y points down,
   * so left of {x,y} is {y,−x}) and up/down only start the game.
   */
  const steer = useCallback((dir) => {
    // Steering mid-run takes the wheel back from the autopilot. From idle the
    // press only starts the run, and the autopilot keeps driving.
    if (autopilotRef.current && stateRef.current !== 'idle') {
      autopilotRef.current = false;
      setAutopilot(false);
    }
    if (!turnRef.current) { applyDir(dir); return; }
    const last = dirQueueRef.current.length > 0
      ? dirQueueRef.current[dirQueueRef.current.length - 1]
      : dirRef.current;
    if (dir.x === -1)     applyDir({ x: last.y,  y: -last.x });
    else if (dir.x === 1) applyDir({ x: -last.y, y: last.x });
    else                  applyDir(last);   // same heading: ignored, but starts an idle game
  }, [applyDir]);

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

  /**
   * Flip between classic and wrap-around mode.
   *
   * Locked while a run is in progress (running or paused): switching to wrap
   * mid-run would let the player dodge an imminent wall death, and the run's
   * score would be recorded against the wrong mode's best.
   */
  const toggleWrap = useCallback(() => {
    if (stateRef.current !== 'idle' && stateRef.current !== 'dead') return;
    const next = !wrapRef.current;
    wrapRef.current = next;
    setWrap(next);
    try { localStorage.setItem(WRAP_KEY, next ? '1' : '0'); } catch (e) { console.warn('[useSnake] localStorage write failed:', e.message); }
    // Best score is per mode — show the record for the mode about to be played.
    const nextBest = readBestScore(bestKey(next));
    bestRef.current = nextBest;
    setBest(nextBest);
  }, []);

  /**
   * Flip autopilot. Allowed in any state; turning it on from idle starts the
   * run (this is a user gesture, so music may start here).
   */
  const toggleAutopilot = useCallback(() => {
    const next = !autopilotRef.current;
    autopilotRef.current = next;
    setAutopilot(next);
    if (next && stateRef.current === 'idle') applyDir(dirRef.current);
  }, [applyDir]);

  const reset = useCallback(() => {
    stopLoop();
    stopMusic();
    clearBanner();
    headIdxRef.current  = initPool(INIT_SNAKE);   // returns 0; fills pool
    snakeLenRef.current = INIT_SNAKE.length;
    dirRef.current      = { x: 1, y: 0 };
    dirQueueRef.current = [];
    clearQueued();
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
    assistedRef.current       = false;
    setAssisted(false);
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
      markInput(e);
      steer(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steer, pause, reset]);

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
    score, best, levelIndex, state, banner, wrap, autopilot, assisted,
    // Actions
    applyDir, steer, pause, reset, toggleWrap, toggleAutopilot,
  };
}
