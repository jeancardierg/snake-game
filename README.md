# Snake — React + Vite

Classic Snake game with endless procedurally generated levels — each with its own identifier, visual theme, obstacle layout, and 8-bit background track — 3D WebGL rendering via three.js, and synthesized 8-bit audio. Built with React + Vite; auto-deployed to GitHub Pages.

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
  - [audio.js](#audiojs)
  - [music.js](#musicjs)
  - [useSnake.js](#usesnakejs)
  - [App.jsx](#appjsx)
  - [GameCanvas.jsx](#gamecanvasjsx)
  - [DPad.jsx](#dpadjsx)
  - [Scoreboard.jsx](#scoreboardjsx)
  - [LevelBar.jsx](#levelbarjsx)
  - [Overlay.jsx](#overlayjsx)
  - [index.css](#indexcss)
  - [main.jsx](#mainjsx)
  - [vite.config.js](#viteconfigjs)
  - [deploy.yml](#deployyml)
- [Game Logic Deep Dive](#game-logic-deep-dive)
- [Running Locally](#running-locally)
- [Deployment](#deployment)
- [Tech Stack](#tech-stack)

---

## How to Play

| Action | Keyboard | Mobile (touch) | Mobile (D-Pad) |
|--------|----------|----------------|----------------|
| Move | Arrow keys or WASD | Swipe in any direction | On-screen D-Pad buttons |
| Pause / Resume | `P` | Pause button | Pause button |
| Restart (after death) | `Enter` or `Space` | Play Again button | Play Again button |

The snake starts moving as soon as you press a direction key, swipe, or tap a D-Pad button.

---

## Features

- **3D WebGL rendering** — a coral-snake body drawn as one continuous, tapered **spline tube** (yellow/red/black scale bands) with a lateral "slither" wave, real-time shadows, directional sun + ambient lighting, and a ground plane recolored per level theme
- **Animated snake head** — a sleek wedge head with eyes and a periodically flicking forked tongue, oriented along the direction of travel
- **Endless generated levels** — level *N* is derived deterministically from *N*: speed, theme, music and obstacle layout. The first five keep the original tier names (EASY → MEDIUM → FAST → HYPER → INSANE); progression never ends
- **Level identity** — every level has a stable id (`L07`) and title (`LEVEL 07 · NEBULA`) shown in the Overlay, in the Scoreboard badge, and in a transient level-up banner over the live board
- **Per-level visual themes** — 10 hand-authored palettes (ground, sky, grid, lighting, food, walls) that cycle with a hue rotation, applied to the three.js scene in place
- **Generated obstacle layouts** — 4-way mirrored patterns (pillars, corners, cross, diagonal, ring) that grow denser with level, always validated reachable and always clear of the spawn runway
- **8-bit background music** — a two-bar chiptune loop per level (square lead, triangle bass, noise percussion), generated from the level seed and synthesized live; mutable, with the choice persisted
- **Per-food speed boost** — each food eaten within a level shaves 8 ms off the tick interval, up to a hard floor of 40 ms
- **Automatic level-up** based on score thresholds derived from a foods-per-level quota
- **Mine food** — a dark metallic sphere with spike protrusions and a blinking red detonator; eating it fires a point-light flash and an orange particle burst
- **8-bit sound effects** — synthesized on the fly with the Web Audio API (game start, eat, level-up, death)
- **Best score** saved in `localStorage` across sessions
- **High-DPI aware** — WebGL pixel ratio is set to `devicePixelRatio`; the drawing buffer is a fixed 200-unit board scaled to fit the container, so it's sharpest on high-DPI / mobile screens
- **Input queue** — up to 2 direction changes buffered per tick, so rapid inputs are never lost
- **Auto-pause on tab switch** — game pauses when you leave the browser tab
- **On-screen D-Pad** — 4-button directional pad for mobile, fires on pointer-down (zero latency)
- **Swipe controls** — swipe gesture support on the game board (20 px threshold)
- **Full-width mobile layout** — canvas fills the screen edge-to-edge on mobile
- **Content Security Policy** — CSP meta tag blocks inline scripts and external resources
- **Accessible** — ARIA labels on D-Pad buttons and canvas, `role="progressbar"` on level bar, focus-visible styles

---

## Project Structure

```
snake-react/
├── .github/
│   └── workflows/
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
│   ├── constants.js            # Grid dimensions, level curve tunables, input constants
│   ├── levels.js               # Deterministic infinite level generator (themes, obstacles)
│   ├── music.js                # 8-bit background music sequencer (Web Audio API)
│   ├── index.css               # Global styles and layout
│   ├── main.jsx                # React entry point
│   └── pool.js                 # Circular ring-buffer for zero-allocation segments
├── index.html                  # HTML shell (includes CSP meta tag)
├── vite.config.js              # Vite build config
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
  │     ├── obstaclesRef  ← current level's walls: {set, cells}
  │     ├── score         ← current score
  │     ├── best          ← all-time best (localStorage)
  │     ├── levelIndex    ← current level (unbounded — see levels.js)
  │     ├── banner        ← transient level-up announcement, or null
  │     └── state         ← 'idle' | 'running' | 'paused' | 'dead'
  │
  ├── <Scoreboard>        ← reads: score, best, levelIndex, state
  ├── <LevelBar>          ← reads: score, levelIndex
  ├── <GameCanvas>        ← reads refs: headIdxRef, snakeLenRef, foodRef, obstaclesRef (+ levelIndex, stateRef) → renders via WebGL
  ├── <DPad>              ← calls: applyDir
  └── <Overlay>           ← reads: state, score, levelIndex, banner
```

Level data is not part of that flow: `getLevel(n)` in `levels.js` is a pure, memoized function, so every component derives speed, theme, identifier and music from `levelIndex` on its own rather than threading a level object through props.

**Data flow is one-way:** `useSnake` owns all mutable state. Components receive props and render. User actions (keyboard, swipe, D-Pad buttons) call the three action functions exported by the hook: `applyDir`, `pause`, `reset`.

**Why refs alongside state?**
The game loop runs inside a `setInterval`. Because closures capture variables at creation time, a plain `useState` value inside the interval would always read its initial value (stale closure). Every piece of game state that the tick function needs to read or write is mirrored in a `useRef` so it's always current. React state is updated in parallel so the UI re-renders.

**Why a ring buffer?**
The snake can be up to 100 segments long and the game loop runs up to ~25 times per second at the speed floor. Prepending to a JavaScript array every tick causes O(n) memory moves and GC pressure. The ring buffer (`pool.js`) pre-allocates all 100 segment objects once and mutates them in-place — zero allocation per tick regardless of snake length or speed.

---

## File-by-File Reference

### `constants.js`

Defines every magic number in one place.

```js
COLS = 10             // grid width in cells
ROWS = 10             // grid height in cells
CELL = 20             // pixel size of each cell (logical pixels)
BASE_SPEED = 300      // level 0 tick interval in ms
SPEED_DECAY = 0.9     // speed multiplier applied per level
FOODS_BASE = 5        // foods needed to clear level 0
FOODS_PER_LEVEL = 1.5 // added per level, floored
FOODS_MAX = 20        // quota plateau
MAX_OBSTACLES = 12    // hard cap on wall cells per level
SPEED_PER_FOOD = 8    // ms subtracted from tick interval per food eaten within a level
SPEED_FLOOR = 40      // minimum tick interval in ms (hard cap)
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
speedForLevel(n) = max(SPEED_FLOOR, BASE_SPEED × SPEED_DECAY^n)
```

Since every food is worth exactly 10 points, "eat N foods to clear the level" and "cross score threshold T" are the same mechanism — which is why the engine keeps its original threshold-driven level-up code.

**Themes.** 10 hand-authored palettes. Past the first cycle each palette is reused with every color hue-rotated by `37° × cycle`, and the label gains a numeral (`FAST II`, `HYPER III`) — so level 13 is visibly and audibly distinct from level 3.

**Obstacles.** Built from 4-way mirrored groups so layouts read as designed rather than as noise. A group is taken only if it fits entirely within the cell budget and touches no reserved cell; partial groups would break the symmetry.

Two hard guarantees, both covered by tests over 200 levels:

- **Spawn safety** — no cell on the spawn row within the starting runway (`y === 5 && x <= 7`), so the player can never die before pressing a key. Kept in sync with `INIT_SNAKE` in `useSnake.js`.
- **Reachability** — `isReachable()` flood-fills from the spawn head and requires every free cell to be reachable. On failure the last group is dropped and the check repeats, falling back to an empty board. This is the critical guard: an unreachable pocket would let `randomFood` spawn food the player can never eat, soft-locking the level with no visible error.

---

### `pool.js`

Pre-allocates `POOL_SIZE = COLS × ROWS = 100` `{x, y}` objects as a circular ring buffer.

| Export | Description |
|--------|-------------|
| `segPool` | Shared array of 100 segment objects — read by `GameCanvas`, written by `useSnake` |
| `POOL_SIZE` | Constant 100 — maximum possible snake length |
| `initPool(segments)` | Writes an initial segment array head-first; returns `headIdx = 0` |
| `poolPrepend(headIdx, x, y)` | Writes a new head at `(headIdx − 1) % POOL_SIZE` in O(1); returns new `headIdx` |
| `poolGet(headIdx, i)` | Returns segment at logical index `i` (0 = head) |

`GameCanvas` reads `segPool` directly on every animation frame without triggering any React re-render.

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
| `stopMusic()` | Stop the scheduler and fade out any already-queued notes |
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
different levels do not.

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
| `best` / `bestRef` | `number` | All-time best, persisted in `localStorage` |
| `levelIndex` / `levelRef` | `number` | Current level index (unbounded — see `levels.js`) |
| `obstaclesRef` | `{set, cells}` | Current level's wall cells: a `Set` of `x*ROWS+y` keys for O(1) collision checks, plus the matching cell list for `GameCanvas` |
| `banner` | `object \| null` | Transient level-up announcement, cleared by a timer |
| `state` / `stateRef` | `string` | Game state machine value |
| `dirRef` | `{x,y}` | Direction applied on the last tick |
| `dirQueueRef` | `{x,y}[]` | Buffered upcoming directions (max 2) |
| `speedRef` | `number` | Current tick interval in ms (preserves boost across pause/resume) |
| `foodsThisLevelRef` | `number` | Foods eaten in current level (drives per-food speed boost) |
| `intervalRef` | `number` | ID of the active `setInterval` |

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
                      wall/self hit
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
Called by `setInterval` every N milliseconds.
1. Dequeues the next direction (rejects 180° reversals and duplicates).
2. Computes new head position via `poolPrepend`.
3. Wall collision → `die()`.
4. Self collision → `die()`.
5. Food eaten → score +10, level-up check, per-food speed boost, new food spawned.
6. Not food → `snakeLenRef -= 1` (tail slot stays in pool, gets overwritten on the next prepend).

**Per-food speed boost:**
```js
const boostedSpeed = Math.max(SPEED_FLOOR,
  getLevel(level).speed - foodsThisLevel * SPEED_PER_FOOD);
```
Resets to the new base speed on every level-up. `speedRef` persists the current interval across pause/resume so the boost is not lost.

**`applyDir(newDir)`**
Validates against the last queued direction, then pushes to `dirQueueRef`. If `state === 'idle'`, transitions to `running` and starts the loop — the idle check runs **before** direction filters so all four directions can start the game (including LEFT/RIGHT which would otherwise be filtered against `INIT_DIR = {x:1, y:0}`).

**`randomFood(headIdx, snakeLen)`**
Builds the occupied set in one pass through `segPool`, collects all free cells, picks uniformly at random. Returns `null` only when all 100 cells are occupied (board full).

#### Side effects

| Effect | Purpose |
|--------|---------|
| `window.addEventListener('keydown', ...)` | Keyboard input (arrows, WASD, P, Enter/Space) |
| `document.addEventListener('visibilitychange', ...)` | Auto-pause on tab switch |
| `useEffect(() => () => stopLoop(), [])` | Clears interval on unmount |

---

### `App.jsx`

The root component. Calls `useSnake()` and distributes the returned values to child components.

Swipe gesture detection runs here: `onTouchStart` records the finger's starting position; `onTouchEnd` computes the delta and calls `applyDir` based on the dominant axis. A `SWIPE_THRESHOLD` (20 px) filters accidental micro-movements. `touchAction: 'none'` prevents browser scroll/zoom interference.

Maintains `stateRef` and `scoreRef` — plain ref mirrors of React state that `GameCanvas`'s rAF loop can read without triggering re-renders.

---

### `GameCanvas.jsx`

Renders the game board using a **three.js WebGL** renderer. The scene is created
once on mount and fully disposed on unmount — geometries, materials, and textures
are walked and released (`renderer.dispose()` alone does not free them), avoiding
a GPU-memory leak on remount / React Strict Mode.

#### Scene setup (created once on mount, disposed on unmount)

| Object | Description |
|--------|-------------|
| `WebGLRenderer` | Targets the `<canvas>` element; `setPixelRatio(devicePixelRatio)`; fixed 200×200-unit drawing buffer, CSS-scaled to the container |
| `OrthographicCamera` | Top-down view; `left/right/top/bottom = ±HALF (100)`; `cam.up = (0,0,−1)` so grid row 0 appears at the screen top |
| `AmbientLight(0xfff6ec, 0.4)` | Warm-neutral base fill — prevents pure-shadow areas going black |
| `DirectionalLight(0xfff4e0, 0.85)` | Sun from the upper-left; casts `PCFSoftShadowMap` shadows on the ground |
| `DirectionalLight(0x6688aa, 0.2)` | Cool fill from the lower-right for depth separation |
| `PlaneGeometry(SIZE, SIZE)` | Ground plane, `receiveShadow = true`; recolored per level theme |
| `LineSegments` | Grid cell borders at Y=0.5 |
| `InstancedMesh` | Obstacle blocks, fixed capacity `MAX_OBSTACLES`; `count` set per level, matrices written only when the layout changes — never in the rAF loop |

The colors above are the *level 0* defaults; every one of them is theme-driven.

#### Per-level theming

A second effect keyed on `levelIndex` recolors the scene **in place** —
`scene.background`, the ground, grid, lights, food and obstacle materials —
reading handles published on a ref by the mount effect. The scene graph is never
rebuilt: teardown and rebuild would re-run the full disposal path on every
level-up, which is both wasteful and leak-prone.

Obstacle instances come from the engine's `obstaclesRef`, not from
`getLevel(levelIndex).obstacles`: `useSnake` drops any generated cell that would
land on the snake, the food, or directly ahead of the head, so the two can
legitimately differ mid-run.

#### Snake rendering

The snake body is **one continuous tube**, not a chain of spheres:

- **Body**: a single `BufferGeometry` of fixed capacity, rebuilt in place every frame (`setDrawRange` controls the live length — no per-frame allocation). A Catmull-Rom spline is fit through the interpolated segment centers and sampled into rings; the tube **tapers** neck → tail and carries a lateral **slither wave** whose amplitude ramps from 0 at the head so the head stays grid-accurate. The coral-snake **scale texture** (yellow → red → yellow → black bands, built by `makeSnakeBodyTexture`) repeats along the length.
- **Head**: a scaled `SphereGeometry` wedge (slim, elongated, `−Z` = forward) with two eyes (gold sphere + black pupil) and a **forked tongue** that flicks periodically while running — all parented to the head so they move and rotate with it.
- **Head direction**: `headMesh.rotation.y = atan2(−ndx, −ndz)` from the head→neck vector each frame (the snout faces `−Z`).
- **Head interpolation**: measures the real tick interval, sets `interpDuration = measured × 0.92` (clamped 40–400 ms), and smoothstep-interpolates the head between grid cells each rAF frame for fluid movement.

#### Food rendering

The food is a **mine**: a `Group` containing a dark metallic `SphereGeometry`, **8 cone spikes**, and a small **red detonator** on top that blinks (emissive sine pulse). The whole group spins slowly around Y.

#### Coordinate mapping

```
world X = col * CELL − HALF + CELL/2   (range −90 to +90)
world Z = row * CELL − HALF + CELL/2   (range −90 to +90)
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

On-screen 4-button directional pad for mobile players.

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
| `idle` | Title "SNAKE" + level title + swipe/keyboard/D-Pad hints |
| `paused` | "PAUSED" + level title + Resume button |
| `dead` | "GAME OVER" + final score + level title reached + Play Again button |
| `running` | Nothing — unless `banner` is set, then only the level-up banner |

The level identifier (`LEVEL 07 · NEBULA`) is rendered in `.overlay-level-id`, tinted with the level accent color.

The banner is the one thing that renders while the game is running. It is `pointer-events: none` and has no backdrop, so it announces the new level without interrupting play. It is owned by `useSnake` rather than derived in `App` from a `levelIndex` change, because only the hook knows when an advance actually happened — a reset back to the same index must not re-announce it.

---

### `index.css`

Global styles with a dark theme. Key sections:

- **Body** — centered flex layout, `#0a0a0f` background
- **`.app`** — vertical flex column, full width on mobile, max-width 420px on desktop (≥900px)
- **`.canvas-wrap`** — `aspect-ratio: 1` container, `position: relative` for overlay positioning
- **`.dpad`** — CSS Grid `3×3` layout; center cell empty; buttons at N/S/E/W
- **`.dpad-btn`** — `touch-action: none; user-select: none` for immediate pointer events
- **`.overlay`** — `position: absolute; inset: 0` + `backdrop-filter: blur`
- **Color contrast** — all text meets WCAG AA on `#0a0a0f` background

---

### `main.jsx`

Standard Vite + React entry point. Mounts `<App>` inside React's `StrictMode` into `#root`.

---

### `vite.config.js`

```js
base: '/snake-game/'
```

Prefixes all asset URLs so the app works at `https://jeancardierg.github.io/snake-game/`.

---

### `deploy.yml`

GitHub Actions workflow on push to `master`:

1. Checkout + Node 20 setup with npm cache
2. `npm ci` — clean install from lockfile
3. `npm run lint` — ESLint gate
4. `npm test` — Vitest suite gate
5. `npm audit --omit=dev --audit-level=high` — fails the build on any high/critical production-dependency vulnerability
6. `npm run build` → `dist/`
7. Upload `dist/` as GitHub Pages artifact
8. Deploy via OIDC authentication (no secrets required)

`concurrency: cancel-in-progress: true` ensures only one deployment runs at a time.

---

## Game Logic Deep Dive

### The tick loop

Every N milliseconds (N = current boosted speed):

```
tick()
 │
 ├─ Dequeue next direction from dirQueueRef
 │   └─ Reject 180° reversals and no-ops
 │
 ├─ newHead = poolPrepend(headIdx, head.x + dir.x, head.y + dir.y)
 │
 ├─ Wall check: head.x < 0 or >= COLS, head.y < 0 or >= ROWS → die()
 │
 ├─ Self check: any active segment == head → die()
 │
 ├─ Ate food?
 │   ├─ YES → score += 10, level-up check, speed boost, new food spawned
 │   │         (snakeLenRef unchanged → body grows by 1 via the prepended head)
 │   └─ NO  → snakeLenRef -= 1  (old tail slot stays, overwritten on next prepend)
 │
 └─ Update headIdxRef; call setScore/setState for React re-render
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

### Per-food speed boost

```
speed = max(SPEED_FLOOR, getLevel(level).speed − foodsThisLevel × SPEED_PER_FOOD)
```

| Constant | Value | Effect |
|----------|-------|--------|
| `SPEED_PER_FOOD` | 8 ms | Subtracted per food within a level |
| `SPEED_FLOOR` | 40 ms | Maximum of ~25 ticks/second |

The boost accumulates within a level and resets to the new base speed on level-up. `speedRef` persists the current interval across pause/resume so the boost is not lost when pausing.

### Level-up

```js
while (newScore >= getLevel(lvl).scoreNext) lvl++;
```

Handles the edge case of skipping multiple levels in one eat. The loop has no upper bound — there is no final level — and terminates because `scoreNext` is strictly increasing.

Level-up restarts the interval at the new base speed, resets `foodsThisLevel`, installs the new obstacle layout, starts the new track, and shows the level banner. Obstacles are installed **before** the replacement food is placed, or food could spawn inside a freshly added wall.

**Mid-run layout swap.** The new layout lands on a board that is already in play, so `spawnExclusions()` drops any generated cell that is currently occupied by the snake, holds the current food, or lies in the two cells directly ahead of the head. Without that last exclusion a level-up could drop a wall into the snake's face — an unavoidable death.

---

## Running Locally

**Requirements:** Node.js 18+ and npm.

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
| `npm test` | Run Vitest unit tests |

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
| three.js | 0.183 | WebGL 3D renderer |
| Web Audio API | — | Synthesized 8-bit sound effects |
| Vitest | 4 | Unit testing |
| GitHub Actions | — | CI/CD (build + audit + deploy) |
| GitHub Pages | — | Static hosting |
