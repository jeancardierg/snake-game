# Snake — React + Vite

A classic Snake game built with React, rendered with a **three.js WebGL** engine, and deployed automatically to GitHub Pages via GitHub Actions.

**Live demo:** https://jeancardierg.github.io/snake-game/

---

## Table of Contents

- [How to Play](#how-to-play)
- [Features](#features)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [File-by-File Reference](#file-by-file-reference)
  - [constants.js](#constantsjs)
  - [pool.js](#pooljs)
  - [useSnake.js](#usesnakejs)
  - [App.jsx](#appjsx)
  - [GameCanvas.jsx](#gamecanvasjsx)
  - [DPad.jsx](#dpadjsx)
  - [Scoreboard.jsx](#scoreboardjsx)
  - [LevelBar.jsx](#levelbarju)
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

- **3D WebGL rendering** — Phong-shaded sphere segments with real-time shadows, directional sun + ambient lighting, and a desert ground plane
- **5 progressive speed levels** — EASY → MEDIUM → FAST → HYPER → INSANE
- **Per-food speed boost** — each food eaten within a level shaves 8 ms off the tick interval, up to a hard floor of 40 ms
- **Automatic level-up** based on score thresholds
- **6 random fruit types** — each food spawn picks a random fruit (apple, orange, strawberry, banana, watermelon, grape); colour-matched particles burst on eat
- **Best score** saved in `localStorage` across sessions
- **Retina/high-DPI rendering** — WebGL pixel ratio set to `devicePixelRatio` for crisp output on all screens
- **Input queue** — up to 2 direction changes buffered per tick, so rapid inputs are never lost
- **Auto-pause on tab switch** — game pauses when you leave the browser tab
- **On-screen D-Pad** — 4-button directional pad for mobile, fires on pointer-down (zero latency)
- **Swipe controls** — full-screen swipe gesture support on mobile (20 px threshold)
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
│   │   ├── ErrorBoundary.jsx   # React error boundary wrapping the canvas
│   │   ├── GameCanvas.jsx      # WebGL renderer (three.js)
│   │   ├── LevelBar.jsx        # Progress bar to next level
│   │   ├── Overlay.jsx         # Idle / Paused / Game Over screens
│   │   └── Scoreboard.jsx      # Score, best score, level badge
│   ├── hooks/
│   │   └── useSnake.js         # All game logic (single source of truth)
│   ├── App.jsx                 # Root component — wires everything together
│   ├── constants.js            # Grid dimensions, level configs, input constants
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
  │     ├── foodRef       ← current food {x, y, type}
  │     ├── score         ← current score
  │     ├── best          ← all-time best (localStorage)
  │     ├── levelIndex    ← current level (0–4)
  │     └── state         ← 'idle' | 'running' | 'paused' | 'dead'
  │
  ├── <Scoreboard>        ← reads: score, best, levelIndex
  ├── <LevelBar>          ← reads: score, levelIndex
  ├── <GameCanvas>        ← reads refs: headIdxRef, snakeLenRef, foodRef → renders via WebGL
  ├── <DPad>              ← calls: applyDir
  └── <Overlay>           ← reads: state, score, levelIndex
```

**Data flow is one-way:** `useSnake` owns all mutable state. Components receive props and render. User actions (keyboard, swipe, D-Pad buttons) call the three action functions exported by the hook: `applyDir`, `pause`, `reset`.

**Why refs alongside state?**
The game loop runs inside a `setInterval`. Because closures capture variables at creation time, a plain `useState` value inside the interval would always read its initial value (stale closure). Every piece of game state that the tick function needs to read or write is mirrored in a `useRef` so it's always current. React state is updated in parallel so the UI re-renders.

**Why a ring buffer?**
The snake can be up to 100 segments long and the game loop runs up to ~25 times per second at INSANE speed. Prepending to a JavaScript array every tick causes O(n) memory moves and GC pressure. The ring buffer (`pool.js`) pre-allocates all 100 segment objects once and mutates them in-place — zero allocation per tick regardless of snake length or speed.

---

## File-by-File Reference

### `constants.js`

Defines every magic number in one place.

```js
COLS = 10          // grid width in cells
ROWS = 10          // grid height in cells
CELL = 20          // pixel size of each cell (logical pixels)
SPEED_PER_FOOD = 8 // ms subtracted from tick interval per food eaten within a level
SPEED_FLOOR = 40   // minimum tick interval in ms (hard cap)
DIR_QUEUE_MAX = 2  // maximum buffered direction changes
SWIPE_THRESHOLD = 20  // minimum swipe travel in pixels
```

`LEVELS` is an array of 5 objects:

| Field | Type | Meaning |
|-------|------|---------|
| `label` | string | Display name (EASY, MEDIUM, …) |
| `speed` | number | Base tick interval in ms (lower = faster) |
| `scoreNext` | number | Score needed to advance to the next level |
| `color` | string | Hex accent color used for UI elements at this level |

`DIR` is a convenience object of pre-built direction vectors (`UP`, `DOWN`, `LEFT`, `RIGHT`).

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

### `useSnake.js`

**The entire game engine.** This single custom hook contains all state, all refs, all game logic, and all side effects.

#### State and refs

| Name | Type | Purpose |
|------|------|---------|
| `headIdxRef` | `number` | Index of the head segment in `segPool` |
| `snakeLenRef` | `number` | Current live segment count |
| `foodRef` | `{x,y,type}` | Current food cell + fruit type (0–5) |
| `score` / `scoreRef` | `number` | Current score (10 pts per food) |
| `best` / `bestRef` | `number` | All-time best, persisted in `localStorage` |
| `levelIndex` / `levelRef` | `number` | Current level index (0–4) |
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
  LEVELS[level].speed - foodsThisLevel * SPEED_PER_FOOD);
```
Resets to the new base speed on every level-up. `speedRef` persists the current interval across pause/resume so the boost is not lost.

**`applyDir(newDir)`**
Validates against the last queued direction, then pushes to `dirQueueRef`. If `state === 'idle'`, transitions to `running` and starts the loop — the idle check runs **before** direction filters so all four directions can start the game (including LEFT/RIGHT which would otherwise be filtered against `INIT_DIR = {x:1, y:0}`).

**`randomFood(headIdx, snakeLen)`**
Builds the occupied set in one pass through `segPool`, collects all free cells, picks uniformly at random. Returns `null` only when all 100 cells are occupied (board full). Food object includes `.type = Math.floor(Math.random() * 6)` for fruit selection.

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

Renders the game board using a **three.js WebGL** renderer.

#### Scene setup (created once on mount, disposed on unmount)

| Object | Description |
|--------|-------------|
| `WebGLRenderer` | Targets the `<canvas>` element; `setPixelRatio(devicePixelRatio)` for Retina |
| `OrthographicCamera` | Top-down view; `left/right/top/bottom = ±HALF (100)`; `cam.up = (0,0,−1)` so grid row 0 appears at the screen top |
| `AmbientLight(0xffe8c8, 0.55)` | Warm base fill — prevents pure-shadow areas going black |
| `DirectionalLight(0xfffde8, 1.1)` | Sun from upper-left; casts `PCFSoftShadowMap` shadows on the ground |
| `DirectionalLight(0xc8e8ff, 0.25)` | Cool fill from lower-right for depth separation |
| `PlaneGeometry(SIZE, SIZE)` | Sandy desert ground, `receiveShadow = true` |
| `LineSegments` | Grid cell borders at Y=0.5 |

#### Snake rendering

- **Body segments**: `SphereGeometry(r=8.2, 20 width, 14 height segments)` with dark-green `MeshPhongMaterial`. One mesh per pool slot (100 total), hidden when not in the active snake. Each frame positions only the live `snakeLenRef` segments — O(snakeLen) per frame.
- **Head**: Larger `SphereGeometry(r=9.4)` with brighter specular. Two eye sub-meshes (gold sphere + black pupil) are parented to the head mesh and rotate with it automatically.
- **Head direction**: `headMesh.rotation.y = atan2(dx, dz)` computed from the head→neck vector each frame.
- **Head interpolation**: Measures the real tick interval, sets `interpDuration = measured × 0.88`, and linearly interpolates the head's world position between grid cells each rAF frame for smooth movement.

#### Food rendering

Six `SphereGeometry` meshes (one per fruit type) are pre-created with distinct `MeshPhongMaterial` colours. Only the current food's mesh is visible; it rotates `+0.022 rad/frame` around Y for a spin effect.

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
| Eat particle burst | `THREE.Points` (`BufferGeometry`); 12 particles per eat, colour from fruit type |
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
- **SCORE** — current score, coloured with the level accent colour
- **Level badge** — level name with a tinted background
- **BEST** — all-time best score

---

### `LevelBar.jsx`

Progress bar toward the next level.

```
progress = (score − prevThreshold) / (nextThreshold − prevThreshold)
```

On INSANE (final level), `progress = 1` always and the label shows "MAX LEVEL". Has ARIA `role="progressbar"` with `aria-valuenow`.

---

### `Overlay.jsx`

Semi-transparent panel rendered over the canvas for non-running states:

| `state` | Shows |
|---------|-------|
| `idle` | Title "SNAKE" + swipe/keyboard/D-Pad hints |
| `paused` | "PAUSED" + Resume button |
| `dead` | "GAME OVER" + final score + Play Again button |

Returns `null` when `state === 'running'`.

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
3. `npm audit --omit=dev` — fails the build if any production dependency has a known vulnerability
4. `npm run build` → `dist/`
5. Upload `dist/` as GitHub Pages artifact
6. Deploy via OIDC authentication (no secrets required)

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
speed = max(SPEED_FLOOR, LEVELS[level].speed − foodsThisLevel × SPEED_PER_FOOD)
```

| Constant | Value | Effect |
|----------|-------|--------|
| `SPEED_PER_FOOD` | 8 ms | Subtracted per food within a level |
| `SPEED_FLOOR` | 40 ms | Maximum of ~25 ticks/second |

The boost accumulates within a level and resets to the new base speed on level-up. `speedRef` persists the current interval across pause/resume so the boost is not lost when pausing.

### Level-up

```js
while (lvl < LEVELS.length - 1 && newScore >= LEVELS[lvl].scoreNext) lvl++;
```

Handles the edge case of skipping multiple levels in one eat. Level-up restarts the interval at the new base speed and resets `foodsThisLevel`.

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

---

## Deployment

Deployment is fully automatic. Every push to `master` triggers the GitHub Actions workflow in `.github/workflows/deploy.yml`, which builds the project and pushes it to the `github-pages` environment.

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
| Vitest | 4 | Unit testing |
| GitHub Actions | — | CI/CD (build + audit + deploy) |
| GitHub Pages | — | Static hosting |
