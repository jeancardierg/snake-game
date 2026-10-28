# Snake — React + Vite

Classic Snake on a 13×13 board with endless procedurally generated levels — each with its own identifier, visual theme, obstacle layout, and 8-bit background track — 3D WebGL rendering via three.js, and synthesized 8-bit audio. The layout fits any screen, from small phones (portrait or landscape) to large desktops. Built with React + Vite; auto-deployed to GitHub Pages.

**Live demo:** https://jeancardierg.github.io/snake-game/

---

## Table of Contents

- [How to Play](#how-to-play)
- [Features](#features)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [File-by-File Reference](#file-by-file-reference)
  - [constants.js](#constantsjs)
  - [levels.js](#levelsjs)
  - [pool.js](#pooljs)
  - [canvasSize.js](#canvassizejs)
  - [audio.js](#audiojs)
  - [music.js](#musicjs)
  - [useSnake.js](#usesnakejs)
  - [App.jsx](#appjsx)
  - [GameCanvas.jsx](#gamecanvasjsx)
  - [DPad.jsx](#dpadjsx)
  - [Scoreboard.jsx](#scoreboardjsx)
  - [LevelBar.jsx](#levelbarjsx)
  - [Overlay.jsx](#overlayjsx)
  - [ErrorBoundary.jsx](#errorboundaryjsx)
  - [index.css](#indexcss)
  - [main.jsx](#mainjsx)
  - [vite.config.js](#viteconfigjs)
  - [deploy.yml](#deployyml)
  - [ci.yml](#ciyml)
- [Game Logic Deep Dive](#game-logic-deep-dive)
- [Running Locally](#running-locally)
- [Deployment](#deployment)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## How to Play

| Action | Keyboard | Mobile (touch) | Mobile (D-Pad) |
|--------|----------|----------------|----------------|
| Move | Arrow keys or WASD | Swipe in any direction | On-screen D-Pad buttons |
| Pause / Resume | `P` | Pause button | Pause button |
| Restart (after death) | `Enter` or `Space` | Play Again button | Play Again button |
| Mute / Unmute music | — | 🔊 Music button | 🔊 Music button |
| Walls / Wrap mode (before a run or after game over) | — | 🧱 Walls / 🌀 Wrap button | 🧱 Walls / 🌀 Wrap button |
| Autopilot on / off (any time; steering takes over) | — | 🤖 Auto button | 🤖 Auto button |

The snake starts moving as soon as you press a direction key, swipe, or tap a D-Pad button.

---

## Features

- **3D WebGL rendering** — a coral-snake body drawn as one continuous, tapered **spline tube** (yellow/red/black scale bands) with a lateral "slither" wave, real-time shadows, directional sun + ambient lighting, and a ground plane recolored per level theme
- **Animated snake head** — a sleek wedge head with eyes and a periodically flicking forked tongue, oriented along the direction of travel
- **13×13 board** — odd-sized so the snake spawns on the mirror axis of the symmetric obstacle layouts; up to 169 segments
- **Endless generated levels** — level *N* is derived deterministically from *N*: speed, theme, music and obstacle layout. The first five keep the original tier names (EASY → MEDIUM → FAST → HYPER → INSANE); progression never ends
- **Level identity** — every level has a stable id (`L07`) and title (`LEVEL 07 · NEBULA`) shown in the Overlay, in the Scoreboard badge, and in a transient level-up banner over the live board
- **Per-level visual themes** — 10 hand-authored palettes (ground, sky, grid, lighting, food, walls) that cycle with a hue rotation, applied to the three.js scene in place
- **Generated obstacle layouts** — 4-way mirrored patterns (pillars, corners, cross, diagonal, ring); every level after L01 has walls, the budget grows with level (scaled to board area, capped at ~12% of the board), layouts are always validated reachable and always clear of the spawn runway
- **Deferred walls** — on a mid-run level-up, walls that would land on the snake or the food are held back and drop in as soon as their cell is clear, never within 2 steps of the head
- **8-bit background music** — a two-bar chiptune loop per level (square lead, triangle bass, noise percussion), generated from the level seed and synthesized live; can be muted with the 🔊 Music button, and the choice is persisted in `localStorage`
- **Human-paced speed curve** — levels speed up toward a 100 ms floor (10 moves/s) instead of 40 ms; each food speeds the current level up by 1.5% (at most 15%) and the ramp resets on level-up. Tuned against human reaction time and input latency — see [Speed and human limits](#speed-and-human-limits)
- **Automatic level-up** based on score thresholds derived from a foods-per-level quota
- **Mine food** — a dark metallic sphere with spike protrusions and a blinking red detonator; eating it fires a point-light flash and an orange particle burst
- **8-bit sound effects** — synthesized on the fly with the Web Audio API (game start, eat, level-up, death)
- **Autopilot** — the 🤖 Auto button lets the snake steer itself (`src/autopilot.js`): shortest path to the food when it can still reach its own tail afterwards, otherwise it follows its tail to stall safely. Grid-based, so it works in every camera view including Chase cam, and respects walls, wrap and obstacles. Turning it on from the start screen starts the run; steering by hand mid-run takes back control. A run the autopilot steered at any point never sets a best score (the game-over screen says so). Session-only, off on load
- **Wrap-around mode** — optional: the board edges become portals, so the snake leaves one edge and re-enters from the opposite one instead of dying. Toggled with the 🧱 Walls / 🌀 Wrap button before a run or after game over (locked mid-run), persisted in `localStorage`; the edges glow in the level's accent color and the body renders sliding continuously through the portal. Classic walls are the default
- **Best score** saved in `localStorage` across sessions, tracked separately for classic and wrap mode and per board size (records from another grid size don't carry over)
- **Sharp at any size** — the WebGL drawing buffer follows the canvas's real CSS size × `devicePixelRatio` (capped at 2), so the board renders 1:1 instead of being upscaled; it re-sizes on layout changes, rotation, monitor switches and zoom
- **Input queue** — up to 2 direction changes buffered at a time (one is consumed per tick), so rapid inputs are never lost
- **Auto-pause on tab switch** — game pauses when you leave the browser tab
- **On-screen D-Pad** — 4-button directional pad on touch devices (phones and tablets; hidden where there is a mouse/trackpad), fires on pointer-down (zero latency)
- **Swipe controls** — swipe gesture support on the game board (20 px threshold)
- **Fits every screen** — one full-height column: the board is the largest square that fits the space left by the score bar and controls (up to 720 px on desktop), so nothing sits below the fold on small phones; landscape phones switch to board-left / controls-right. Safe-area aware for notches and home bars
- **Content Security Policy** — CSP meta tag blocks inline scripts and external resources
- **Accessible** — ARIA labels on D-Pad buttons and canvas, `role="progressbar"` on level bar, focus-visible styles

---

## Project Structure

```
snake-game/                     # repo root (package name is "snake-react")
├── .github/
│   ├── dependabot.yml          # Weekly npm + GitHub Actions version updates
│   └── workflows/
│       ├── ci.yml              # Lint/test/audit/build gate on every pull request
│       └── deploy.yml          # Auto-deploy to GitHub Pages on push to master
├── public/
│   └── favicon.svg             # Browser tab icon
├── src/
│   ├── components/
│   │   ├── DPad.jsx            # On-screen directional pad (mobile)
│   │   ├── ErrorBoundary.jsx   # React error boundary wrapping the app
│   │   ├── GameCanvas.jsx      # WebGL renderer (three.js)
│   │   ├── LevelBar.jsx        # Progress bar to next level
│   │   ├── Overlay.jsx         # Idle / Paused / Game Over screens
│   │   └── Scoreboard.jsx      # Score, best score, level badge + pause button
│   ├── hooks/
│   │   └── useSnake.js         # All game logic (single source of truth)
│   ├── test/                   # Vitest unit + hook tests
│   ├── App.jsx                 # Root component — wires everything together
│   ├── audio.js                # 8-bit sound effects (Web Audio API)
│   ├── canvasSize.js           # WebGL drawing-buffer sizing (pure, unit-tested)
│   ├── shadowFit.js            # Sun shadow-box fit to the board (pure, unit-tested)
│   ├── snakeProfile.js         # Head/neck dimensions and neck profile (pure, unit-tested)
│   ├── constants.js            # Grid dimensions, level curve tunables, input constants
│   ├── levels.js               # Deterministic infinite level generator (themes, obstacles)
│   ├── music.js                # 8-bit background music sequencer (Web Audio API)
│   ├── index.css               # Global styles and layout
│   ├── main.jsx                # React entry point
│   └── pool.js                 # Circular ring-buffer for zero-allocation segments
├── index.html                  # HTML shell (includes CSP meta tag)
├── vite.config.js              # Vite build config + Vitest (jsdom) config
├── eslint.config.js            # ESLint flat config
├── SECURITY.md                 # Security model, CSP rationale, threat notes
├── CLAUDE.md                   # Agent/contributor working rules for this repo
├── LICENSE                     # GPL-3.0 (verbatim)
└── package.json
```

---

## Architecture Overview

```
App.jsx
  │
  ├── useSnake()          ← all state + logic lives here
  │     ├── headIdxRef    ← head index into the shared segment ring buffer
  │     ├── snakeLenRef   ← live segment count
  │     ├── foodRef       ← current food {x, y}
  │     ├── obstaclesRef  ← current level's walls: {set, cells, pending, version}
  │     ├── score         ← current score
  │     ├── best          ← all-time best for the current mode and board size (localStorage)
  │     ├── wrap          ← wrap-around mode on/off (localStorage)
  │     ├── levelIndex    ← current level (unbounded — see levels.js)
  │     ├── banner        ← transient level-up announcement, or null
  │     └── state         ← 'idle' | 'running' | 'paused' | 'dead'
  │
  ├── <Scoreboard>        ← reads: score, best, levelIndex, state
  ├── <LevelBar>          ← reads: score, levelIndex
  ├── <GameCanvas>        ← reads refs: headIdxRef, snakeLenRef, foodRef, obstaclesRef (+ levelIndex, stateRef, wrap) → renders via WebGL
  ├── <DPad>              ← calls: applyDir
  ├── <Overlay>           ← reads: state, score, levelIndex, banner
  └── controls-hint       ← Pause / Reset buttons + music mute toggle (music.js) + mode toggle (calls toggleWrap)
```

Level data is not part of that flow: `getLevel(n)` in `levels.js` is a pure, memoized function, so every component derives speed, theme, identifier and music from `levelIndex` on its own rather than threading a level object through props.

**Data flow is one-way:** `useSnake` owns all mutable state. Components receive props and render. User actions (keyboard, swipe, D-Pad buttons) call the action functions exported by the hook: `applyDir`, `pause`, `reset`, `toggleWrap`, `toggleAutopilot`.

**Why refs alongside state?**
The game loop runs inside a `setInterval`. Because closures capture variables at creation time, a plain `useState` value inside the interval would always read its initial value (stale closure). Every piece of game state that the tick function needs to read or write is mirrored in a `useRef` so it's always current. React state is updated in parallel so the UI re-renders.

**Why a ring buffer?**
The snake can be up to `COLS × ROWS` = 169 segments long and the game loop runs up to 10 times per second at the speed floor. Prepending to a JavaScript array every tick causes O(n) memory moves and GC pressure. The ring buffer (`pool.js`) pre-allocates all 169 segment objects once and mutates them in-place — zero allocation per tick regardless of snake length or speed.

---

## File-by-File Reference

### `constants.js`

Defines every magic number in one place.

```js
COLS = 13             // grid width in cells (odd: the spawn row is the obstacle mirror axis)
ROWS = 13             // grid height in cells
CELL = 20             // world units per cell (on-screen size comes from the layout)
BASE_SPEED = 300      // level 0 tick interval in ms
SPEED_FLOOR = 100     // asymptote and hard minimum tick interval in ms (10 moves/s)
SPEED_APPROACH = 0.88 // fraction of (speed − floor) kept per level
FOODS_BASE = 5        // foods needed to clear level 0
FOODS_PER_LEVEL = 1.5 // added per level, floored
FOODS_MAX = 20        // quota plateau
MAX_OBSTACLES = 20    // hard cap on wall cells per level: ~12% of the board, multiple of 4
SPEED_RAMP_PER_FOOD = 0.015 // 1.5% faster per food eaten within a level
SPEED_RAMP_MAX = 0.15       // at most 15% faster than the level's base speed
DIR_QUEUE_MAX = 2     // maximum buffered direction changes
SWIPE_THRESHOLD = 20  // minimum swipe travel in pixels
```

Levels themselves are **not** enumerated here — they are generated, see [`levels.js`](#levelsjs).

`DIR` is a convenience object of pre-built direction vectors (`UP`, `DOWN`, `LEFT`, `RIGHT`).

---

### `levels.js`

Deterministic infinite level generator. Level *N* is derived entirely from *N* — the same index yields the same speed, theme, music and obstacle layout on every machine and every run. `Math.random()` is deliberately not used, so layouts are reproducible and testable.

`getLevel(n)` (memoized) returns:

| Field | Type | Meaning |
|-------|------|---------|
| `index` | number | The level index |
| `id` | string | Short stable identifier, e.g. `L07` — shown in the Scoreboard badge |
| `label` | string | Theme name, e.g. `NEBULA`; the first five are the original tier names |
| `title` | string | Full identifier, e.g. `LEVEL 07 · NEBULA` — shown in the Overlay |
| `speed` | number | Base tick interval in ms (lower = faster) |
| `scoreNext` | number | Score at which this level ends |
| `foods` | number | Foods required to clear the level |
| `color` | string | Hex accent color for the DOM chrome |
| `theme` | object | three.js hex colors: `bg`, `ground`, `grid`, `obstacle`, `ambient`, `sun`, `fill`, `food` |
| `music` | object | Track descriptor: `root`, `scale`, `wave`, `bpm`, `seed` |
| `obstacles` | array | `{x, y}` wall cells for the level |

**Curves.** All three are monotonic, which is what guarantees the level-up loop terminates:

```
foodsForLevel(n) = min(FOODS_MAX, FOODS_BASE + floor(n × FOODS_PER_LEVEL))
scoreNextFor(n)  = Σ foodsForLevel(0..n) × 10        // strictly increasing
speedForLevel(n) = round(SPEED_FLOOR + (BASE_SPEED − SPEED_FLOOR) × SPEED_APPROACH^n)   // approaches the floor
speedAfterFoods(n, k) = max(SPEED_FLOOR, round(speedForLevel(n) × (1 − min(SPEED_RAMP_MAX, k × SPEED_RAMP_PER_FOOD))))
```

Since every food is worth exactly 10 points, "eat N foods to clear the level" and "cross score threshold T" are the same mechanism — which is why the engine keeps its original threshold-driven level-up code.

**Themes.** 10 hand-authored palettes. Past the first cycle each palette is reused with its scene colors (`bg`, `ground`, `grid`, `obstacle`, `fill`) hue-rotated by `37° × cycle`, and the label gains a numeral (`FAST II`, `HYPER III`) — so level 13 is visibly and audibly distinct from level 3. The two light tints (`ambient`, `sun`) and `food` are deliberately left un-rotated, so lighting stays neutral and the mine stays near-black at every cycle.

**Obstacles.** Built from 4-way mirrored groups so layouts read as designed rather than as noise. A group is taken only if it fits entirely within the cell budget, touches no reserved cell, and keeps the board reachable; partial groups would break the symmetry.

- **Budget** — `obstacleTarget(n)`: 0 on level 0, then `floor(n × 1.2 × area/100)` but never less than one 4-cell group and never more than `MAX_OBSTACLES`. On 13×13: L02–L03 → 4, L06 → 10, L11+ → 20.
- **Seeds** — base cells come from the top-left quadrant, one cell in from the border. On an even board the quadrant stops before the row that mirrors onto the spawn row (every group there would be rejected); on an odd board the spawn row is the mirror axis itself. Pattern offsets are clamped to the quadrant, so layouts survive a grid resize.
- **Top-up** — if a pattern falls short of its budget, mirrored pillars from the level's own RNG fill the rest (bounded, deterministic).

Two hard guarantees, both covered by tests over 200 levels:

- **Spawn safety** — no cell on the spawn row within the starting runway (`y === SPAWN_ROW && x <= SPAWN_RUNWAY_X`; on 13×13: row 6, x ≤ 8), so the player can never die before pressing a key. `SPAWN_ROW`, `SPAWN_HEAD_X` and `SPAWN_RUNWAY_X` derive from the grid and `useSnake` builds `INIT_SNAKE` from them.
- **Reachability** — `isReachable()` flood-fills from the spawn head and requires every free cell to be reachable. Every group is checked as it is added (a sealing group is skipped and the top-up continues); a defensive final check drops groups on failure, falling back to an empty board. This is the critical guard: an unreachable pocket would let `randomFood` spawn food the player can never eat, soft-locking the level with no visible error.

---

### `pool.js`

Pre-allocates `POOL_SIZE = COLS × ROWS = 169` `{x, y}` objects as a circular ring buffer.

| Export | Description |
|--------|-------------|
| `segPool` | Shared array of 169 segment objects — read by `GameCanvas`, written by `useSnake` |
| `POOL_SIZE` | `COLS × ROWS` (169) — maximum possible snake length |
| `initPool(segments)` | Writes an initial segment array head-first; returns `headIdx = 0` |
| `poolPrepend(headIdx, x, y)` | Writes a new head at `(headIdx − 1) % POOL_SIZE` in O(1); returns new `headIdx` |
| `poolGet(headIdx, i)` | Returns segment at logical index `i` (0 = head) |

`GameCanvas` reads `segPool` directly on every animation frame without triggering any React re-render.

---

### `canvasSize.js`

Pure sizing for the WebGL drawing buffer, kept out of `GameCanvas` so it can be unit-tested without WebGL.

| Export | Description |
|---|---|
| `computeCanvasSize(cssW, cssH, dpr)` | Returns `{ width, height, pixelRatio, viewport }`: the canvas's CSS size (rounded, never below 1), the pixel ratio capped at `MAX_PIXEL_RATIO`, and the largest centred square viewport, so a non-square canvas is letterboxed rather than stretched |
| `MAX_PIXEL_RATIO` | `2` — 3× phones gain nothing visible at this scale, while fill cost grows with the square of the ratio |

`GameCanvas` applies it on mount and from a `ResizeObserver`; the rAF loop re-applies it when `devicePixelRatio` changes, which `ResizeObserver` does not report.

---

### `audio.js`

Retro 8-bit sound effects synthesized at runtime with the **Web Audio API** — no
audio files shipped. A single `AudioContext` is created lazily on first use (the
browser autoplay policy requires creation during a user gesture) and resumed if
suspended.

| Export | Sound |
|--------|-------|
| `playStart()`   | Ascending C5→E5→G5 arpeggio (square wave) |
| `playEat()`     | Short A5→C6 chirp |
| `playLevelUp()` | 4-note ascending fanfare (sawtooth) |
| `playDeath()`   | Descending C5→C3 slide |
| `getCtx()`      | The shared `AudioContext`, or `null` when Web Audio is unavailable |

`useSnake` calls these from the tick loop and state transitions; if the Web Audio
API is unavailable the calls are silent no-ops.

`getCtx()` is exported so `music.js` can reuse the same context — browsers cap
the number of live `AudioContext`s, and two contexts cannot be mixed through one
destination.

---

### `music.js`

Looping 8-bit background music, one track per level, synthesized at runtime.

**No audio files.** The CSP in `index.html` is `default-src 'self'` with no
`media-src`, so `data:`/`blob:` audio and any CDN are blocked. Pure Web Audio
synthesis sidesteps the policy entirely and needs no change to it.

| Export | Description |
|--------|-------------|
| `startMusic(track)` | Start or switch to a level's track; restarts the loop from step 0 |
| `stopMusic({ keepTrack })` | Stop the scheduler and fade out any already-queued notes; `keepTrack: true` remembers the descriptor so resume/unmute can pick it back up |
| `pauseMusic()` / `resumeMusic()` | Suspend and restore, keeping the current track |
| `setMusicEnabled(bool)` / `isMusicEnabled()` | Mute toggle, persisted in `localStorage` under `snakeMusic` |
| `buildPattern(track)` | Compile a track descriptor into a two-bar pattern (exported for tests) |

**Scheduling.** A coarse `setInterval` (25 ms) wakes often enough to queue every
note falling inside the next 150 ms, each with its start time expressed against
`ctx.currentTime`. Scheduling notes with `setTimeout` directly drifts audibly
within a few bars.

**Voices.** Square (or sawtooth/triangle, per theme) lead, triangle bass, and a
white-noise blip on the backbeat, all routed through one `musicGain` so the SFX
in `audio.js` stay on top. Notes get an 8 ms attack ramp — stepping the gain
instantly clicks audibly at 16th-note density.

**Patterns** are generated from the level's `music` descriptor with the same
seeded PRNG as the layouts, so a given level always sounds the same and
different levels do not. Tempo is not fixed per theme: `levels.js` adds `2 × n` BPM
to the base tempo, capped at 180, so the track tightens as the run goes on.

Every entry point is a no-op when `getCtx()` returns `null`. That is not
cosmetic: jsdom has no `AudioContext`, and the hook tests drive
start/pause/resume/stop through the real game loop, so a music function that
threw without Web Audio would break the whole suite.

---

### `useSnake.js`

**The entire game engine.** This single custom hook contains all state, all refs, all game logic, and all side effects.

#### State and refs

| Name | Type | Purpose |
|------|------|---------|
| `headIdxRef` | `number` | Index of the head segment in `segPool` |
| `snakeLenRef` | `number` | Current live segment count |
| `foodRef` | `{x,y}` | Current food cell (the mine) |
| `score` / `scoreRef` | `number` | Current score (10 pts per food) |
| `best` / `bestRef` | `number` | All-time best for the current mode and board size, persisted in `localStorage` (`snakeBest_13x13` classic, `snakeBestWrap_13x13` wrap). Records from another grid size are not carried over; the 10×10-era keys `snakeBest` / `snakeBestWrap` are removed on load |
| `wrap` / `wrapRef` | `boolean` | Wrap-around mode, persisted in `localStorage` under `snakeWrap`; changed only via `toggleWrap()` while idle or dead |
| `levelIndex` / `levelRef` | `number` | Current level index (unbounded — see `levels.js`) |
| `obstaclesRef` | `{set, cells, pending, version}` | Current level's walls: a `Set` of `x*ROWS+y` keys for O(1) collision checks, the matching cell list for `GameCanvas`, layout cells still waiting to be placed (`pending`), and a session-monotonic `version` the renderer re-syncs on |
| `banner` | `object \| null` | Transient level-up announcement, cleared by a timer |
| `state` / `stateRef` | `string` | Game state machine value |
| `dirRef` | `{x,y}` | Direction applied on the last tick |
| `dirQueueRef` | `{x,y}[]` | Buffered upcoming directions (max 2) |
| `speedRef` | `number` | Current tick interval in ms (preserves boost across pause/resume) |
| `foodsThisLevelRef` | `number` | Foods eaten in current level (drives the per-food speed ramp) |
| `intervalRef` | `number` | ID of the active `setInterval` |
| `tickRef` | `function` | Latest `tick` closure; the interval calls `tickRef.current()` so it never runs a stale one |
| `bannerTimerRef` | `number` | ID of the timer that clears `banner` |

#### Game state machine

```
         applyDir()
  idle ──────────────► running
                          │
              pause()     │   pause()
           ┌─────────────►│◄──────────┐
           │           paused         │
           └──────────────────────────┘
                          │
       wall (classic) / obstacle / self hit
                          │
                          ▼
                        dead
                          │
                       reset()
                          │
                          ▼
                         idle
```

#### Key functions

**`tick()`**
Called by `setInterval` every N milliseconds. Collision checks all run **before** the
head is written into the ring buffer, so a fatal move never mutates `segPool`.
1. Dequeues the next direction (rejects 180° reversals).
2. Computes the candidate head position (`head + dir`).
3. Board edge: in wrap mode the position is wrapped onto the opposite edge (`(hx + COLS) % COLS`, same for rows); in classic mode leaving the board → `die()`.
4. Obstacle collision (`obstaclesRef.current.set` lookup) → `die()` — a generated wall is as fatal as the board edge.
5. Self collision → `die()`. Index 0 is skipped (the old head cell can never equal the new one), and when the snake is **not** eating the tail is skipped too: it vacates its cell on this same tick, so moving into it is legal (canonical Snake). When eating, the tail stays put and the full body is checked.
6. Commits the head via `poolPrepend` and increments `snakeLenRef`.
7. Food eaten → score +10, best-score update, level-up check, per-food speed ramp, new food spawned.
8. Not food → `snakeLenRef -= 1` (tail slot stays in pool, gets overwritten on the next prepend).
9. `placePendingObstacles()` drops in any pending walls whose cell is now clear of the snake, the food, the look-ahead and the `HEAD_CLEARANCE` (2-step) radius around the head.

**Per-food speed ramp:**
```js
const boostedSpeed = speedAfterFoods(levelRef.current, foodsThisLevelRef.current);
```
Resets to the new base speed on every level-up. `speedRef` persists the current interval across pause/resume so the boost is not lost.

**`applyDir(newDir)`**
Validates against the last queued direction, then pushes to `dirQueueRef`. If `state === 'idle'`, transitions to `running` and starts the loop — the idle check runs **before** direction filters so all four directions can start the game (including LEFT/RIGHT which would otherwise be filtered against `INIT_DIR = {x:1, y:0}`).

**`randomFood(headIdx, snakeLen, obstacles)`**
Seeds the occupied set from the level's obstacle keys, adds every snake cell in one pass through `segPool`, collects all free cells, then picks uniformly at random. Returns `null` only when no free cell is left (snake + obstacles cover the board).

#### Side effects

| Effect | Purpose |
|--------|---------|
| `window.addEventListener('keydown', ...)` | Keyboard input (arrows, WASD, P, Enter/Space). The key→direction map is prototype-free, so a synthetic `__proto__`/`toString` key can't resolve to an inherited property |
| `document.addEventListener('visibilitychange', ...)` | Auto-pause on tab switch. Only an auto-pause is auto-resumed — a manual pause survives the tab coming back |
| Unmount cleanup | Clears the tick interval, calls `stopMusic()` (the scheduler interval would otherwise outlive the component), and clears the banner timer |

---

### `App.jsx`

The root component. Calls `useSnake()` and distributes the returned values to child components.

Swipe gesture detection runs here: `onTouchStart` records the finger's starting position; `onTouchEnd` computes the delta and calls `applyDir` based on the dominant axis. A `SWIPE_THRESHOLD` (20 px) filters accidental micro-movements. `touchAction: 'none'` prevents browser scroll/zoom interference.

Maintains `stateRef` — a plain ref mirror of the `state` value that `GameCanvas`'s rAF loop reads without triggering re-renders (it drives the slither/tongue animation and the death shake).

Also owns the music mute mirror: `music.js` holds the preference and its `localStorage` persistence, and `App` keeps a `musicOn` state only so the 🔊 Music button label re-renders. The `.controls-hint` row below the D-Pad holds that button plus Pause, Reset and the walls/wrap toggle.

---

### `GameCanvas.jsx`

Renders the game board using a **three.js WebGL** renderer. The scene is created
once on mount and fully disposed on unmount — geometries, materials, and textures
are walked and released (`renderer.dispose()` alone does not free them), avoiding
a GPU-memory leak on remount / React Strict Mode.

#### Scene setup (created once on mount, disposed on unmount)

| Object | Description |
|--------|-------------|
| `WebGLRenderer` | Targets the `<canvas>` element; a `ResizeObserver` keeps the drawing buffer at the canvas's real CSS size × `devicePixelRatio` (capped at 2, see `canvasSize.js`), so the board renders 1:1 instead of being upscaled; pixel-ratio changes (monitor switch, zoom) are caught in the rAF loop |
| `OrthographicCamera` | Top-down view; `left/right/top/bottom = ±HALF (130)`; `cam.up = (0,0,−1)` so grid row 0 appears at the screen top |
| `AmbientLight(0xfff6ec, 0.4)` | Warm-neutral base fill — prevents pure-shadow areas going black |
| `DirectionalLight(0xfff4e0, 0.85)` | Sun from the upper-left; casts `PCFShadowMap` shadows on the ground |
| `DirectionalLight(0x6688aa, 0.2)` | Cool fill from the lower-right for depth separation |
| `PlaneGeometry(SIZE, SIZE)` | Ground plane, `receiveShadow = true`; recolored per level theme |
| `LineSegments` | Grid cell borders at Y=0.5 |
| `InstancedMesh` | Obstacle blocks, fixed capacity `MAX_OBSTACLES`; the rAF loop rewrites matrices only when `obstaclesRef.current.version` changes (level-up, reset, or a deferred wall dropping in) — a single integer compare on every other frame |

The colors above are the *level 0* defaults; every one of them is theme-driven.

#### Per-level theming

A second effect keyed on `levelIndex` recolors the scene **in place** —
`scene.background`, the ground, grid, lights, food and obstacle materials —
reading handles published on a ref by the mount effect. The scene graph is never
rebuilt: teardown and rebuild would re-run the full disposal path on every
level-up, which is both wasteful and leak-prone.

Obstacle instances come from the engine's `obstaclesRef`, not from
`getLevel(levelIndex).obstacles`. On a mid-run level-up, `useSnake` holds back any
generated cell that would land on the snake, the food, or directly ahead of the
head, and keeps it in `pending`. Each tick drops pending walls in once their cell
is clear, keeping a 2-step radius around the head free so a queued turn can never
run into a wall that just appeared. Until then the two layouts legitimately differ.

#### Snake rendering

The snake body is **one continuous tube**, not a chain of spheres:

- **Body**: a single `BufferGeometry` of fixed capacity, rebuilt in place every frame (`setDrawRange` controls the live length — no per-frame allocation). A Catmull-Rom spline is fit through the interpolated segment centers and sampled into rings; the tube **tapers** neck → tail and carries a lateral **slither wave** whose amplitude ramps from 0 at the head so the head stays grid-accurate. The coral-snake **scale texture** (yellow → red → yellow → black bands, built by `makeSnakeBodyTexture`) repeats along the length, laid out by distance so the yellow collar starts exactly where the neck leaves the head.
- **Neck** (`snakeProfile.js`): the tube starts thin and low *inside* the head (`NECK_R` ≈ 62% of body radius, resting on the ground) and widens to full body radius over `NECK_LEN` (1.1 cells), so the body emerges from under the back of the head (`NECK_EXIT` ≈ 9 units behind its centre) instead of cutting across it. Unit-tested against the head ellipsoid.
- **Head**: a scaled `SphereGeometry` wedge (slim, elongated, `−Z` = forward) with two eyes (gold sphere + black pupil) and a **forked tongue** that flicks periodically while running — all parented to the head so they move and rotate with it.
- **Head direction**: follows the body spline — the direction from a point half a cell down the neck to the head (`headDir`, set by the tube builder) — so the head turns smoothly with the body through corners instead of snapping 90°. `rotation.y = atan2(−dx, −dz)` (the snout faces `−Z`).
- **Head interpolation**: measures the real tick interval, sets `interpDuration = measured × 0.92` (clamped 40–400 ms), and smoothstep-interpolates the head between grid cells each rAF frame for fluid movement.
- **Wrap mode**: grid deltas are normalised to the shortest way round the board (`wrapDelta`), and the centerline is **unwrapped** — each point is shifted by whole boards to sit next to its predecessor, so the path stays continuous off the board edge. The tube is built once along that path; for every other board-sized tile the path touches, a copy mesh sharing the tube's buffers is drawn shifted back onto the board (three head clones do the same for the head). The orthographic frustum is exactly the board, so the off-board part of every copy is cut away for free — no clipping planes. Four additive glow strips mark the portal edges, tinted with the level's accent color and pulsing while visible.

#### Food rendering

The food is a **mine**: a `Group` containing a dark metallic `SphereGeometry`, **8 cone spikes**, and a small **red detonator** on top that blinks (emissive sine pulse). The whole group spins slowly around Y.

#### Coordinate mapping

```
world X = col * CELL − HALF + CELL/2   (range −120 to +120 on 13×13)
world Z = row * CELL − HALF + CELL/2   (range −120 to +120 on 13×13)
world Y = resting height above ground
```

Camera at `(0, 300, 0)` with `up = (0, 0, −1)`: smaller Z → higher on screen, matching the grid's row-0-at-top convention.

#### Effects

| Effect | Implementation |
|--------|---------------|
| Death camera shake | `cam.position.x/z = amp × sin/cos(t)` over 500 ms |
| Eat point-light flash | `PointLight` at eaten food's world position, intensity decays −0.2/frame |
| Eat particle burst | `THREE.Points` (`BufferGeometry`); 12 particles per eat, fixed orange (`0xff4400`) |
| All inter-frame state | `animRef` (single object ref, no React overhead) |

---

### `DPad.jsx`

On-screen 4-button directional pad for touch devices. Shown wherever the primary pointer is coarse or can't hover (phones, tablets); hidden for mouse/trackpad users via `(hover: hover) and (pointer: fine)` — not by screen width, so tablets and landscape phones keep it. In landscape it sits in the right-hand column beside the board.

- Uses `onPointerDown` (not `onTouchEnd`) — fires on first contact, not finger lift, for zero-latency response
- `e.preventDefault()` suppresses the trailing synthetic click event
- `touch-action: none` in CSS eliminates the browser's default touch delay
- Accent colour tinted per level via CSS custom property `--dpad-color`
- Each button has an `aria-label` (`"Move up"`, etc.)

---

### `Scoreboard.jsx`

Purely presentational. Displays:
- **SCORE** — current score, coloured with the level accent colour; flashes on each increase by re-keying the `<span>` off `score` (no state, no effect)
- **Level badge** — the short level id (`L07`) with a tinted background and the full title as a `title` tooltip; the long title would overflow the badge. Plus a **Pause / Resume button** directly below it (disabled while idle or dead)
- **BEST** — all-time best score

---

### `LevelBar.jsx`

Progress bar toward the next level.

```
progress = (score − prevThreshold) / (nextThreshold − prevThreshold)
```

Progression is endless, so there is always a next level and the former "MAX LEVEL" state no longer exists — the hint shows `→ L08 at 650`. Has ARIA `role="progressbar"` with `aria-valuenow`.

---

### `Overlay.jsx`

Semi-transparent panel rendered over the canvas for non-running states, plus a transient level-up banner shown *during* play:

| `state` | Shows |
|---------|-------|
| `idle` | Title "SNAKE" + level title + keyboard / pause / D-Pad hints |
| `paused` | "PAUSED" + level title + Resume button |
| `dead` | "GAME OVER" + final score + level title reached + Play Again button |
| `running` | Nothing — unless `banner` is set, then only the level-up banner |

The level identifier (`LEVEL 07 · NEBULA`) is rendered in `.overlay-level-id`, tinted with the level accent color.

The banner is the one thing that renders while the game is running. It is `pointer-events: none` and has no backdrop, so it announces the new level without interrupting play. It is owned by `useSnake` rather than derived in `App` from a `levelIndex` change, because only the hook knows when an advance actually happened — a reset back to the same index must not re-announce it.

---

### `ErrorBoundary.jsx`

Class component wrapping the whole app in `main.jsx`. Catches unhandled render and
lifecycle errors below it and shows a "GAME CRASHED" fallback with the error message
and a **Try Again** button (which clears `hasError` and re-renders the tree) instead
of a blank screen.

It is a class because error boundaries have no hooks equivalent as of React 19 —
`getDerivedStateFromError` (switch to the fallback in the same render pass) and
`componentDidCatch` (logs `error` + `info.componentStack`) exist only on classes.

---

### `index.css`

Global styles with a dark theme. Key sections:

- **Body** — centered flex layout, `#0a0a0f` background
- **`.app`** — one full-viewport column (`100svh`, so mobile browser bars never cover the controls) with safe-area padding for notches and home bars. The scoreboard, level bar and controls row line up with the board via `--board-w` (published by `App` from the board's measured width, min 300px).
- **`.board-slot`** — the flexible area left after the fixed rows; a size container (`container-type: size`)
- **`.canvas-wrap`** — the board: `width: min(100cqw, 100cqh, 720px)` + `aspect-ratio: 1`, i.e. the largest square that fits, capped at 720px on desktop. Browsers without size containers fall back to the old `min(100%, 400px)`.
- **`.dpad`** — CSS Grid `3×3` layout; center cell empty; buttons at N/S/E/W. Hidden where the primary pointer is fine and can hover (mouse/trackpad), not by width — tablets and landscape phones keep it.
- **Landscape phones** (`orientation: landscape` and height ≤ 520px) — board left at full height, score / level / D-pad / buttons stacked in a 260px column on the right
- **Short touch screens** — compact scoreboard and tighter gaps below 760px of height; below 620px the D-pad keys go from 44px to 40px (still well above the WCAG 2.5.8 24px minimum); the keyboard hint is hidden on touch devices
- **`.dpad-btn`** — `touch-action: none; user-select: none` for immediate pointer events
- **`.overlay`** — `position: absolute; inset: 0` + `backdrop-filter: blur`
- **Color contrast** — all text meets WCAG AA on `#0a0a0f` background

---

### `main.jsx`

Standard Vite + React entry point. Mounts `<App>` into `#root`, wrapped in
[`<ErrorBoundary>`](#errorboundaryjsx) inside React's `StrictMode`.

---

### `vite.config.js`

```js
base: '/snake-game/'
```

Prefixes all asset URLs so the app works at `https://jeancardierg.github.io/snake-game/`.

---

### `deploy.yml`

GitHub Actions workflow on push to `master`:

1. Checkout + Node 22 setup with npm cache
2. `npm ci` — clean install from lockfile
3. `npm run lint` — ESLint gate
4. `npm test` — Vitest suite gate
5. `npm audit --omit=dev --audit-level=high` — fails the build on any high/critical production-dependency vulnerability
6. `npm run build` → `dist/`
7. `actions/configure-pages` — resolves the Pages deployment target
8. Upload `dist/` as GitHub Pages artifact
9. Deploy via OIDC authentication (`id-token: write`, no secrets required)

`concurrency: cancel-in-progress: true` ensures only one deployment runs at a time.

### `ci.yml`

GitHub Actions workflow on every pull request (including Dependabot PRs). Runs steps 1–6
of `deploy.yml` (install, lint, test, production audit, build) with a read-only token and
no deployment, so a broken change is caught before it reaches `master`. A newer push to
the same PR cancels the in-flight run.

---

## Game Logic Deep Dive

### The tick loop

Every N milliseconds (N = current boosted speed):

```
tick()
 │
 ├─ Dequeue next direction from dirQueueRef
 │   └─ Reject 180° reversals
 │
 ├─ candidate head = (head.x + dir.x, head.y + dir.y)     ← not committed yet
 │
 ├─ Edge:           wrap mode  → hx = (hx+COLS)%COLS, hy = (hy+ROWS)%ROWS
 │                  classic    → hx < 0 or >= COLS, hy < 0 or >= ROWS → die()
 │
 ├─ Obstacle check: obstaclesRef.set.has(hx * ROWS + hy)  → die()
 │
 ├─ Self check:     body segments 1..checkLen == head     → die()
 │   └─ checkLen = snakeLen when eating, snakeLen − 1 otherwise
 │      (the tail vacates its cell this tick, so entering it is legal)
 │
 ├─ headIdx = poolPrepend(headIdx, hx, hy);  snakeLen++
 │
 ├─ Ate food?
 │   ├─ YES → score += 10, best check, level-up check, speed boost, new food spawned
 │   │         (the tick's snakeLen++ is kept → body is 1 longer)
 │   └─ NO  → snakeLenRef -= 1  (old tail slot stays, overwritten on next prepend)
 │
 ├─ Pending walls: place any whose cell is clear (not snake / food / near the head)
 │
 └─ setScore / setLevel / setState only when those values actually changed —
    snake and food positions never go through React at all
```

### Direction queue

Without a queue, pressing RIGHT then UP within a single tick would lose the RIGHT input. The queue buffers up to `DIR_QUEUE_MAX = 2` future directions:

```
Player presses: → then ↑ before next tick

dirQueueRef = [→, ↑]

Tick 1: dequeue →  →  snake turns right
Tick 2: dequeue ↑  →  snake turns up
```

Each direction is validated against the *previous queued direction* (not the current snake direction) so that a 180° flip through an intermediate step is still blocked.

### Speed and human limits

```
speed = speedAfterFoods(level, foodsThisLevel)
      = max(SPEED_FLOOR, round(speedForLevel(level) × (1 − min(15%, foodsThisLevel × 1.5%))))
```

| Constant | Value | Effect |
|----------|-------|--------|
| `BASE_SPEED` | 300 ms | L01 tick interval |
| `SPEED_FLOOR` | 100 ms | Asymptote and hard minimum: 10 moves/second |
| `SPEED_APPROACH` | 0.88 | Fraction of the gap to the floor kept per level |
| `SPEED_RAMP_PER_FOOD` | 1.5% | Faster per food within a level |
| `SPEED_RAMP_MAX` | 15% | Cap on the within-level ramp |

**Why a 100 ms floor.** One tick is one cell. A *reactive* input — to food that just spawned or a wall that just dropped in — lands roughly 350 ms after the event on desktop (choice reaction ≈ 300 ms, plus input and display latency) and roughly 430 ms on phones (touch-to-screen latency was measured at 55–120 ms). Dividing by the tick gives the cells the head travels before that input lands:

| Level | Base → end of level | Reaction travel, desktop / touch |
|---|---|---|
| L01 | 300 → 282 ms | 1.2 / 1.5 cells |
| L05 | 220 → 187 ms | 1.9 / 2.3 cells |
| L10 | 163 → 139 ms | 2.5 / 3.1 cells |
| L20+ | → 100 ms | 3.5 / 4.3 cells |

The previous curve (−8 ms per food, up to 19 foods per level, 40 ms floor) ended L06 at 89 ms and **every level from L08 at 40 ms** — 8.8 cells of reaction travel on desktop, and too short a window to place a turn on the intended cell reliably. Tests in `gameLogic.test.js` now assert the limits: no level faster than 100 ms, at most 3.5 cells of desktop reaction travel at any level, at most 2 cells for L01–L05.

The ramp accumulates within a level and resets to the new base speed on level-up. `speedRef` persists the current interval across pause/resume so the ramp is not lost when pausing.

### Level-up

```js
while (newScore >= getLevel(lvl).scoreNext) lvl++;
```

Handles the edge case of skipping multiple levels in one eat. The loop has no upper bound — there is no final level — and terminates because `scoreNext` is strictly increasing.

Level-up restarts the interval at the new base speed, resets `foodsThisLevel`, installs the new obstacle layout, starts the new track, and shows the level banner. Obstacles are installed **before** the replacement food is placed, or food could spawn inside a freshly added wall.

**Mid-run layout swap.** The new layout lands on a board that is already in play, so `spawnExclusions()` drops any generated cell that is currently occupied by the snake, holds the current food, or lies in the two cells directly ahead of the head. Without that last exclusion a level-up could drop a wall into the snake's face — an unavoidable death. In wrap mode the look-ahead wraps with the head, so a wall can't land just past the portal either.

---

## Running Locally

**Requirements:** Node.js `^22.12.0 || >=24.0.0` and npm. (Vitest 5 requires it; Node 20
is end-of-life and will not run the test suite. CI runs Node 22.)

```bash
git clone https://github.com/jeancardierg/snake-game.git
cd snake-game
npm install
npm run dev
```

Open http://localhost:5173/snake-game/ in your browser.

**Other commands:**

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot module reload |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest suite once (195 tests across 8 files) |
| `npm run test:watch` | Run Vitest in watch mode |

**Jumping to a level.** Append `?level=N` (0-based) to the URL to start on that
level — e.g. http://localhost:5173/snake-game/?level=12. Reaching a late level
by playing takes hundreds of foods, so this is the practical way to check a
theme, layout or track. The value is parsed defensively; anything that is not a
finite non-negative integer is ignored.

---

## Deployment

Deployment is fully automatic. Every push to `master` triggers the GitHub Actions workflow in `.github/workflows/deploy.yml`, which lints, tests, audits, builds the project, and pushes it to the `github-pages` environment.

```bash
git add .
git commit -m "your change"
git push origin master
```

The site updates in ~30 seconds.

---

## Tech Stack

| Tool | Version | Role |
|------|---------|------|
| React | 19 | UI component model |
| Vite | 8 | Dev server + build tool |
| three.js | 0.186 | WebGL 3D renderer |
| Web Audio API | — | Synthesized 8-bit sound effects + background music |
| Vitest | 5 | Unit + hook testing (jsdom 30, Testing Library) |
| GitHub Actions | — | CI/CD (build + audit + deploy) |
| GitHub Pages | — | Static hosting |

---

## License

Copyright © 2026 jeancardierg

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the [GNU General Public License](LICENSE) for more details.

GPL-3.0 is a copyleft license: anyone distributing this project or a derivative
must release their version under GPL-3.0 as well, with source available.
