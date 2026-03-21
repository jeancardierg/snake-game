# Snake — React + Vite

A classic Snake game built with React, rendered on an HTML5 Canvas, and deployed automatically to GitHub Pages via GitHub Actions.

**Live demo:** https://jeancardierg.github.io/snake-game/

---

## Table of Contents

- [How to Play](#how-to-play)
- [Features](#features)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [File-by-File Reference](#file-by-file-reference)
  - [constants.js](#constantsjs)
  - [useSnake.js](#usesnakejs)
  - [App.jsx](#appjsx)
  - [GameCanvas.jsx](#gamecanvasjsx)
  - [Scoreboard.jsx](#scoreboardjsx)
  - [LevelBar.jsx](#levelbarju)
  - [Overlay.jsx](#overlayjsx)
  - [DPad.jsx](#dpadjsx)
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

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move | Arrow keys or WASD | D-Pad buttons |
| Pause / Resume | `P` | Pause button |
| Restart (after death) | `Enter` or `Space` | Play Again button |

The snake starts moving as soon as you press a direction key.

---

## Features

- **5 progressive speed levels** — EASY → MEDIUM → FAST → HYPER → INSANE
- **Automatic level-up** based on score thresholds
- **Best score** saved in `localStorage` across sessions
- **Retina/high-DPI rendering** — canvas scaled by `devicePixelRatio` for crisp pixels on all screens
- **Input queue** — up to 2 direction changes buffered per tick, so rapid inputs are never lost
- **Auto-pause on tab switch** — game pauses when you leave the browser tab
- **Offscreen grid cache** — static grid drawn once and blit each frame for performance
- **Touch D-Pad** — visible on mobile, hidden on desktop
- **Accessible** — ARIA labels, focus-visible styles, progressbar role on level bar

---

## Project Structure

```
snake-react/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Auto-deploy to GitHub Pages on push
├── public/
│   └── favicon.svg             # Browser tab icon
├── src/
│   ├── components/
│   │   ├── DPad.jsx            # Touch directional pad for mobile
│   │   ├── GameCanvas.jsx      # HTML5 Canvas renderer
│   │   ├── LevelBar.jsx        # Progress bar to next level
│   │   ├── Overlay.jsx         # Idle / Paused / Game Over screens
│   │   └── Scoreboard.jsx      # Score, best score, level badge
│   ├── hooks/
│   │   └── useSnake.js         # All game logic (single source of truth)
│   ├── App.jsx                 # Root component — wires everything together
│   ├── App.css                 # (reserved, currently empty)
│   ├── constants.js            # Grid dimensions, level configs
│   ├── index.css               # Global styles and layout
│   └── main.jsx                # React entry point
├── index.html                  # HTML shell
├── vite.config.js              # Vite build config
└── package.json
```

---

## Architecture Overview

```
App.jsx
  │
  ├── useSnake()          ← all state + logic lives here
  │     ├── snake[]       ← array of {x,y} segments
  │     ├── food {x,y}    ← current food position
  │     ├── score         ← current score
  │     ├── best          ← all-time best (localStorage)
  │     ├── levelIndex    ← current level (0–4)
  │     └── state         ← 'idle' | 'running' | 'paused' | 'dead'
  │
  ├── <Scoreboard>        ← reads: score, best, levelIndex
  ├── <LevelBar>          ← reads: score, levelIndex
  ├── <GameCanvas>        ← reads: snake, food, levelIndex  →  draws to <canvas>
  ├── <Overlay>           ← reads: state, score, levelIndex
  └── <DPad>              ← calls: applyDir()
```

**Data flow is one-way:** `useSnake` owns all mutable state. Components receive props and render. User actions (keyboard, D-Pad, buttons) call the three action functions exported by the hook: `applyDir`, `pause`, `reset`.

**Why refs alongside state?**
The game loop runs inside a `setInterval`. Because closures capture variables at creation time, a plain `useState` value inside the interval would always read its initial value (stale closure). Every piece of game state that the tick function needs to read or write is mirrored in a `useRef` so it's always current. React state is updated in parallel so the UI re-renders.

---

## File-by-File Reference

### `constants.js`

Defines every magic number in one place. Import from here instead of hardcoding values in components.

```js
COLS = 20        // grid width in cells
ROWS = 20        // grid height in cells
CELL = 20        // pixel size of each cell (logical pixels)
```

`LEVELS` is an array of 5 objects, one per speed tier:

| Field | Type | Meaning |
|-------|------|---------|
| `label` | string | Display name (EASY, MEDIUM, …) |
| `speed` | number | Tick interval in milliseconds |
| `scoreNext` | number | Score needed to advance to the next level |
| `color` | string | Hex color used for the snake and UI accents at this level |

`DIR` is a convenience object of pre-built direction vectors (`UP`, `DOWN`, `LEFT`, `RIGHT`). Not used directly in the game loop but handy for tests or extensions.

---

### `useSnake.js`

**The entire game engine.** This single custom hook contains all state, all refs, all game logic, and all side effects. No component outside this hook ever modifies game state directly.

#### State and refs

| Name | Type | Purpose |
|------|------|---------|
| `snake` / `snakeRef` | `{x,y}[]` | Ordered list of segments, head first |
| `food` / `foodRef` | `{x,y}` | Current food cell |
| `score` / `scoreRef` | `number` | Current score (10 pts per food) |
| `best` / `bestRef` | `number` | All-time best, persisted in `localStorage` |
| `levelIndex` / `levelRef` | `number` | Current level index (0–4) |
| `state` / `stateRef` | `string` | Game state machine value |
| `dirRef` | `{x,y}` | Direction applied on the last tick |
| `dirQueueRef` | `{x,y}[]` | Buffered upcoming directions (max 2) |
| `intervalRef` | `number` | ID of the active `setInterval` |
| `tickRef` | `function` | Ref to the latest `tick` callback (breaks circular dependency) |

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
Called by `setInterval` every N milliseconds (N = current level speed).
1. Dequeues the next direction from `dirQueueRef` (rejecting 180° reversals).
2. Computes the new head position.
3. Checks for wall collision (`head.x < 0 || head.x >= COLS` etc.) → calls `die()`.
4. Checks for self-collision (`snakeRef.current.some(...)`) → calls `die()`.
5. If the head lands on food: grows snake, increments score, checks level-up, spawns new food.
6. If not food: removes the tail segment (snake moves forward without growing).
7. Updates both the ref and the React state.

`tickRef.current = tick` keeps the ref in sync on every render. `startLoop`'s `setInterval` calls `tickRef.current()` rather than `tick` directly — this breaks the circular `useCallback` dependency between `startLoop` and `tick`.

**`startLoop(lvlIdx)`**
Clears any existing interval and starts a new one at the speed of `LEVELS[lvlIdx]`. Called on game start, resume, and level-up.

**`stopLoop()`**
Clears the interval. Called on pause, death, reset, and component unmount.

**`applyDir(newDir)`**
Called by keyboard handler and D-Pad. Validates against the last queued direction (prevents 180° flip and duplicate inputs), then pushes to `dirQueueRef` (capped at 2). If the game is `idle`, transitions to `running` and starts the loop.

**`pause()`**
Toggles between `running` ↔ `paused`. Stops/starts the interval accordingly.

**`reset()`**
Stops the loop, resets all refs and state to initial values, clears the direction queue.

**`randomFood(snake)`**
Randomly picks a cell not occupied by the snake. Includes an iteration cap (1000 attempts) to avoid an infinite loop if the board is nearly full.

#### Side effects

| Effect | Purpose |
|--------|---------|
| `window.addEventListener('keydown', ...)` | Keyboard input (arrows, WASD, P, Enter/Space) |
| `document.addEventListener('visibilitychange', ...)` | Auto-pause when user switches tabs |
| Cleanup `useEffect(() => () => stopLoop(), [])` | Clears interval when component unmounts |

---

### `App.jsx`

The root component. Calls `useSnake()` and distributes the returned values to child components.

```
useSnake() returns:
  snake, food, score, best, levelIndex, state  → passed as props to display components
  applyDir, pause, reset                        → passed as callbacks to interactive components
```

Also renders the controls hint bar (keyboard shortcut reminder + Pause and Reset buttons) between the canvas and the D-Pad.

---

### `GameCanvas.jsx`

Renders the game board to an HTML5 `<canvas>` element.

#### Retina/high-DPI scaling

The canvas physical pixel dimensions are set to `SIZE × devicePixelRatio`. The 2D context is then scaled by the same ratio with `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. The CSS keeps the canvas at 100% of its container in logical pixels. This means on a 2× Retina display the canvas has 4× the pixels of a standard display, producing sharp lines.

#### Offscreen grid cache (`getGridCanvas()`)

Drawing 41 horizontal and 41 vertical grid lines every frame is wasteful because the grid never changes. `getGridCanvas()` draws the background and all grid lines once into an offscreen `<canvas>` element stored in the module-level `gridCache` variable. Every frame, the main canvas blits the cached result with a single `ctx.drawImage()` call, then draws only the dynamic elements (food and snake) on top.

#### Drawing order

1. `ctx.drawImage(gridCache, ...)` — background + grid (one call)
2. Food — red glowing circle at `food.x * CELL + CELL/2, food.y * CELL + CELL/2`
3. Snake segments — from head (index 0) to tail, with decreasing opacity. Head has a colored glow via `ctx.shadowBlur`. Each segment is a rounded rectangle (`ctx.roundRect`).

#### Opacity encoding

Body segments fade toward the tail. The hex color has a two-digit alpha suffix appended:
```js
const hex = Math.round(alpha * 255).toString(16).padStart(2, '0');
ctx.fillStyle = `${color}${hex}`;  // e.g. "#4ecca3e0"
```
8-digit hex colors (`#RRGGBBAA`) are part of the CSS Color Level 4 spec and are supported in all modern browsers.

---

### `Scoreboard.jsx`

Purely presentational. Displays three items in a row:
- **SCORE** — current score, colored with the current level's accent color
- **Level badge** — level name (EASY / MEDIUM / …) with a tinted background matching the level color
- **BEST** — all-time best score

Receives `score`, `best`, `levelIndex` as props.

---

### `LevelBar.jsx`

A progress bar showing how far the player is toward the next level.

**Progress calculation:**
```
prev  = score threshold of the previous level (0 if on level 0)
next  = score threshold of the current level
progress = (score - prev) / (next - prev)   clamped to [0, 1]
```

On the final level (INSANE), `progress` is always `1` (full bar) and the label shows "MAX LEVEL" instead of the next-level hint.

Has ARIA `role="progressbar"` with `aria-valuenow` for screen reader support.

---

### `Overlay.jsx`

Renders a semi-transparent panel over the canvas for three non-running states:

| `state` | Shows |
|---------|-------|
| `idle` | Title "SNAKE" + keyboard hints |
| `paused` | "PAUSED" + Resume button |
| `dead` | "GAME OVER" + final score + Play Again button |

Returns `null` when `state === 'running'` so nothing obscures the canvas during play.

---

### `DPad.jsx`

A cross-shaped directional pad for touch devices.

**Touch handling:**
Uses `onTouchEnd` (not `onTouchStart`) so the direction fires when the finger lifts, not when it first touches the screen — this prevents accidental input when swiping across the pad. A touch ID set (`handledTouches`) prevents the browser's synthetic `click` event from firing a second time after the touch event.

**Layout:**
Four `<button>` elements absolutely positioned within a 132×132px container:

```
      [▲]
  [◄] [▼] [►]
```

The D-Pad is hidden on screens wider than 900px (keyboard assumed) via a CSS media query.

---

### `index.css`

Global styles with a dark theme. Key sections:

- **Body** — centered flex layout, `#0a0a0f` background
- **`.app`** — vertical flex column, max-width 420px, centered
- **`.scoreboard`** — horizontal flex, space-between, dark card
- **`.level-bar-*`** — thin progress bar with animated fill
- **`.canvas-wrap`** — `aspect-ratio: 1` container, `position: relative` for overlay positioning
- **`.overlay`** — `position: absolute; inset: 0` + `backdrop-filter: blur` for the game state screens
- **`.ctrl-btn` / `.overlay-btn` / `.dpad-btn`** — all have `:focus-visible` outlines for keyboard navigation
- **Color contrast** — all muted text is `#777` or brighter on the `#0a0a0f` background to meet WCAG AA

---

### `main.jsx`

Standard Vite + React entry point. Mounts `<App>` inside React's `StrictMode` (which runs effects twice in development to catch bugs) into the `#root` div in `index.html`.

---

### `vite.config.js`

```js
base: '/snake-game/'
```

This is the only non-default setting. It tells Vite to prefix all asset URLs with `/snake-game/` so the app works correctly when served from `https://jeancardierg.github.io/snake-game/` rather than the root of a domain.

---

### `deploy.yml`

GitHub Actions workflow that runs on every push to `master`:

1. Checks out the repository
2. Sets up Node 20 with npm cache
3. Runs `npm ci` (clean install from lockfile)
4. Runs `npm run build` (outputs to `dist/`)
5. Uploads `dist/` as a GitHub Pages artifact
6. Deploys the artifact to GitHub Pages

The workflow uses OIDC-based authentication (`id-token: write`) — no secrets needed. The `concurrency` block ensures only one deployment runs at a time and cancels any in-progress run if a new push arrives.

---

## Game Logic Deep Dive

### The tick loop

Every N milliseconds (N depends on level):

```
tick()
 │
 ├─ Dequeue next direction from dirQueueRef
 │   └─ Skip if it would reverse 180°
 │
 ├─ Compute new head = {x: head.x + dir.x, y: head.y + dir.y}
 │
 ├─ Wall check: head.x < 0 or >= COLS, head.y < 0 or >= ROWS → die()
 │
 ├─ Self check: any segment == head → die()
 │
 ├─ newSnake = [head, ...snake]   (prepend head)
 │
 ├─ Ate food?
 │   ├─ YES → score += 10, check best, check level-up, spawn new food
 │   │         (tail NOT removed → snake grows by 1)
 │   └─ NO  → newSnake.pop()     (remove tail → snake moves forward)
 │
 └─ Update snakeRef + setSnake (triggers re-render)
```

### Direction queue

Without a queue, pressing Right then Up very quickly within a single tick would lose the Right input (it gets overwritten before `tick` reads it). The queue buffers up to 2 future directions:

```
Player presses: → then ↑ before next tick

dirQueueRef = [→, ↑]

Tick 1: dequeue →  →  snake turns right
Tick 2: dequeue ↑  →  snake turns up
```

Each queued direction is validated against the *previous queued direction* (not the current snake direction) so that a 180° flip through an intermediate direction is still blocked.

### Level-up

After every food eaten:
```js
while (lvl < LEVELS.length - 1 && newScore >= LEVELS[lvl].scoreNext) lvl++;
```
The `while` handles the edge case where a single food eat skips multiple levels (impossible with current thresholds, but safe). If the level changed, `startLoop(newLevel)` is called immediately — the interval is recreated at the new (faster) speed.

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

---

## Deployment

Deployment is fully automatic. Every push to `master` triggers the GitHub Actions workflow in `.github/workflows/deploy.yml`, which builds the project and pushes it to the `github-pages` environment.

To deploy a change:
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
| HTML5 Canvas API | — | Game rendering |
| GitHub Actions | — | CI/CD |
| GitHub Pages | — | Static hosting |
