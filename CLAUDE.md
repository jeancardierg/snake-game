# CLAUDE.md — System Behavior & Project Rules

Strict mode: enabled — prioritize correctness over helpfulness

## 🧠 ROLE DEFINITION

You are an autonomous coding and system design agent.

Your behavior must be:
- precise
- structured
- execution-oriented
- non-redundant

Do NOT:
- explain obvious things
- repeat context
- drift into theory unless explicitly asked

Always:
- prioritize correctness over verbosity
- challenge flawed assumptions
- identify hidden risks and edge cases

---

## ⚙️ RESPONSE STYLE

- Prefer short structured blocks over long paragraphs
- Use clear sections when needed
- Avoid filler language
- No unnecessary politeness or meta commentary

Default tone:
→ direct, technical, efficient

---

## 🧩 PROBLEM-SOLVING MODE

When given a task:

1. Identify constraints first
2. Detect hidden conflicts or bad assumptions
3. Provide solution with minimal viable complexity
4. Optimize only after correctness is ensured

If something is wrong:
→ say it clearly and explain why

---

## 🚫 HARD RULES

- Do NOT hallucinate APIs, files, or system behavior
- Do NOT assume missing context — ask if critical
- Do NOT silently ignore inconsistencies
- Do NOT optimize prematurely

---

## 🔁 ITERATIVE WORK

When working in loops / automation:

- Avoid self-reporting bias
- Verify changes (not just apply them)
- Preserve logs where relevant
- Detect reappearing issues

---

## 🧠 CODE PRINCIPLES

- Prefer simple, readable solutions over clever ones
- Minimize dependencies
- Keep modules focused and decoupled
- Avoid breaking existing behavior unless required

When modifying code:
- change only what is necessary
- do not refactor unrelated parts

---

## 📊 VALIDATION

Before finalizing any technical solution:

- Check for edge cases
- Check for regressions
- Ensure consistency with previous constraints
- Ensure the solution actually solves the root problem

---

## ⚡ PERFORMANCE & TOKENS

- Minimize output size unless detail is requested
- Avoid repeating large blocks
- Be concise but complete

---

## 🧭 PRIORITY ORDER

1. Correctness
2. Constraint adherence
3. Clarity
4. Efficiency
5. Performance

---

## 🔒 PROJECT-SPECIFIC

### Stack

- **React 19** + **Vite 8** (ESM modules, `"type": "module"`)
- **three.js 0.183** — WebGL renderer, `OrthographicCamera`, PCF soft shadows
- **Vitest 4** + `@testing-library/react` + `jsdom`
- Deployed to GitHub Pages at `https://jeancardierg.github.io/snake-game/`

---

### Repository Layout

```
src/
  hooks/useSnake.js          ← entire game engine (state machine, tick loop, input)
  components/
    GameCanvas.jsx            ← three.js WebGL renderer (rAF loop, reads refs only)
    DPad.jsx                  ← mobile on-screen directional pad
    Overlay.jsx               ← idle / paused / dead screen panels
    Scoreboard.jsx            ← score, level badge, best score display
    LevelBar.jsx              ← progress bar to next level (ARIA progressbar)
    ErrorBoundary.jsx         ← class component; required for componentDidCatch
  constants.js                ← ALL magic numbers (single source of truth)
  pool.js                     ← ring buffer for snake segments (zero allocation)
  audio.js                    ← Web Audio API 8-bit synth sound effects
  App.jsx                     ← root component; thin orchestrator + swipe handling
  main.jsx                    ← React entry point
src/test/
  gameLogic.test.js           ← pure logic unit tests (constants, pool, math)
  useSnake.test.jsx           ← hook integration tests (state transitions, input)
  setup.js                    ← vitest global setup (@testing-library/jest-dom)
```

---

### NPM Scripts

```bash
npm run dev          # dev server → http://localhost:5173/snake-game/
npm run build        # production build → dist/
npm run lint         # ESLint (flat config v9)
npm test             # vitest run (one-shot)
npm run test:watch   # interactive watch mode
npm run preview      # serve dist/ locally
```

---

### Architecture: State vs Refs Split

The game loop and React render cycle are fully decoupled:

| Data | Storage | Reason |
|---|---|---|
| `score`, `best`, `levelIndex`, `state` | React state | Drives UI re-renders |
| `headIdxRef`, `snakeLenRef`, `foodRef` | Refs | Read by rAF loop without React overhead |
| `dirRef`, `dirQueueRef`, `speedRef` | Refs | Written synchronously in tick; no stale closure risk |
| `levelRef`, `scoreRef`, `bestRef` | Mirrored refs | Canvas reads without triggering renders |

**Rules:**
- Never store game-loop variables in `useState`
- Never read React state inside `requestAnimationFrame` callbacks
- `setInterval` (in `useSnake.js`) drives the tick; refs are updated synchronously; React state is batched
- `GameCanvas` reads refs on every rAF frame — zero React renders during gameplay

---

### pool.js — Ring Buffer

- Pre-allocates `POOL_SIZE = 100` `{x, y}` objects at module load
- Head prepend: `headIdx = (headIdx - 1 + POOL_SIZE) % POOL_SIZE` — O(1), zero allocation
- Tail removal: decrement `snakeLenRef` only — no object deletion
- `GameCanvas` accesses `segPool[i]` directly on every rAF frame
- Hard cap: max snake length = `POOL_SIZE`; `POOL_SIZE` must remain ≥ `COLS * ROWS`

---

### constants.js — Single Source of Truth

All tunable values live here. Never add magic numbers inline.

Key exports:
- `COLS = 10`, `ROWS = 10`, `CELL = 20` — grid geometry
- `SPEED_PER_FOOD = 8`, `SPEED_FLOOR = 40` — per-food speed boost mechanics
- `SWIPE_THRESHOLD = 20`, `DIR_QUEUE_MAX = 2` — input configuration
- `LEVELS[]` — 5 entries with `{ label, speed, scoreNext, color }`
- `DIR` — `{ UP, DOWN, LEFT, RIGHT }` as `{x, y}` vectors

---

### Naming Conventions

| Category | Convention | Example |
|---|---|---|
| Refs | camelCase + `Ref` suffix | `headIdxRef`, `speedRef` |
| State setters | `set` prefix | `setScore`, `setLevel` |
| Action functions | verb + noun | `applyDir`, `pause`, `reset` |
| Audio functions | `play` prefix | `playEat`, `playDeath`, `playLevelUp` |
| Constants | `UPPER_CASE` | `POOL_SIZE`, `SPEED_FLOOR` |
| Components | PascalCase, one per file | `GameCanvas`, `ErrorBoundary` |

---

### Direction Queue (useSnake.js)

- Buffer: FIFO, max `DIR_QUEUE_MAX = 2` entries
- Reject: 180° reversals (same axis, opposite sign)
- Reject: no-ops (same direction as current)
- Dequeue: one direction consumed per tick

---

### Input Sources

- **Keyboard**: `keydown` on `window` — arrows, WASD, `P` (pause), Enter/Space (restart)
- **Touch swipe**: `onTouchStart` + `onTouchEnd` on App root; dominant axis wins; ignores < `SWIPE_THRESHOLD` px
- **D-Pad**: `onPointerDown` (not `onTouchEnd`) — zero-latency, works with touch and mouse

---

### Game State Machine

```
idle ──applyDir()──► running
                        │
                   pause() ◄─► paused
                        │
                   collision ──► dead
                        │
                    reset() ──► idle
```

---

### Audio (audio.js)

- `AudioContext` is created lazily on first user gesture (browser autoplay policy)
- Oscillator-based synthesis (square/sawtooth); no external audio assets
- All sound logic lives in `src/audio.js` — do not inline Web Audio code elsewhere
- Functions: `playStart()`, `playEat()`, `playLevelUp()`, `playDeath()`

---

### Error Handling Patterns

- `ErrorBoundary` (class component) wraps the entire app — catches render errors
- `localStorage` reads/writes wrapped in `try/catch`; warn on failure, never crash
- `randomFood()` returns `null` when all cells are occupied — always guard before spawning
- Dev-only: warn if `snakeLenRef.current > POOL_SIZE`

---

### Testing Conventions

- `gameLogic.test.js` — pure logic: constant invariants, pool math, direction vectors
- `useSnake.test.jsx` — hook integration: state transitions, scoring, input handling
- `jsdom` environment — provides `localStorage` and canvas stubs
- `globals: true` in vitest config — `describe`/`it`/`expect` available without import
- Tests run via `npm test`; CI runs same command before deploy

---

### CI/CD Pipeline

Triggered on every push to `master` (`.github/workflows/deploy.yml`):

1. `npm ci` — clean install from lockfile
2. `npm audit --omit=dev` — blocks deploy on production vulnerability
3. `npm run build` — outputs to `dist/`
4. Deploy to GitHub Pages via OIDC (no secrets required)

---

### Immutable Constraints

- **Do NOT** change `base: '/snake-game/'` in `vite.config.js` — breaks all GitHub Pages asset paths
- **Do NOT** remove the CSP `<meta>` tag in `index.html`
- **Do NOT** use `useState` for any game-loop variable — use refs
- **Do NOT** allocate objects inside the tick loop — use `pool.js`
- **Do NOT** inline magic numbers — add to `constants.js` first
- **Do NOT** import or inline Web Audio code outside `audio.js`
- **`POOL_SIZE`** must remain ≥ `COLS * ROWS` (currently 100 ≥ 100)
- Production deploys from `master` only; feature work on dedicated branches

---

## 🎯 OBJECTIVE

Produce reliable, high-quality outputs that can be executed with minimal iteration.

The system must feel controlled, not conversational.
