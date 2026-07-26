# Repository Audit — snake-game

Date: 2026-07-26
Scope: full repo (source, tests, build, CI, docs, assets)
Method: static review + empirical run of lint / tests / build / audit on the current tree.

## Resolution status — all 15 items addressed (2026-07-26)

Every finding below was fixed on branch `claude/repo-audit-report-i4qudc`. Post-fix CI-equivalent run:

| Check | Before | After |
|-------|--------|-------|
| `npm run lint` | ❌ 1 error | ✅ clean |
| `npm test` | 66 pass, 0% component cov | ✅ 86 pass; components ~94%, `logic.js` 100% |
| `npm run build` | 722 KB single chunk, >500 KB warning | ✅ split: app 67 KB gzip + three 128 KB gzip, no warning |
| `npm audit --omit=dev --audit-level=high` | ungated | ✅ 0 vulnerabilities, now gated in CI |

Per-item notes:
- **#1** CI: `lint` + `test` steps added; audit gated at `--audit-level=high`.
- **#2** lint: Scoreboard flash reworked to `key={score}` (no `setState`-in-effect).
- **#3** README: rendering / food / lighting / features / CI sections rewritten to the mine + cobra + grey-field reality; `logic.js` documented.
- **#4** tail: self-collision now excludes the tail when not eating (integration-tested both directions).
- **#5** NaN: `readBestScore` coerces non-finite/negative to 0; test tightened to `=== 0`.
- **#6** tests: pure rules extracted to `logic.js` and imported by source + tests; `randomFood` exported + tested; new `components.test.jsx` → 86 tests.
- **#7** bundle: three split into its own cached chunk via `manualChunks`; `chunkSizeWarningLimit` set intentionally.
- **#8** GPU: unmount disposes all geometries / materials / textures, not just the renderer.
- **#9** assets: `hero.png`, `react.svg`, `vite.svg`, `icons.svg` deleted.
- **#10** dead code: `.type`, `scoreRef`, `levelIndexRef`, `App.css`, and the unreachable `reset()` branch removed.
- **#11** comment: `pool.js` corrected to `100`.
- **#12** dev audit: `npm audit fix` applied (prod gate clean). 5 dev-only highs remain in ESLint's transitive `minimatch`; clearing them requires a breaking pre-release ESLint 10 — **deferred** as not worth the risk.
- **#13** CI audit: switched to `--audit-level=high`.
- **#14** DPR: drawing buffer sized to displayed CSS × DPR, re-synced via `ResizeObserver`.
- **#15** allocations: shared scratch `Vector3`; duplicate cobra texture removed.

The original findings are retained below as the record; the empirical baseline is the **pre-fix** state.

## Rating scale

| Severity | Meaning |
|----------|---------|
| **P0 – Critical** | Broken or shipping-blocking; fix now |
| **P1 – High** | Real defect or high-leverage gap; fix soon |
| **P2 – Medium** | Correctness/quality issue with limited blast radius |
| **P3 – Low** | Polish, cleanup, micro-optimization |

Effort: S (<30 min) · M (½–2 h) · L (>2 h)

## Empirical baseline (measured at audit time — pre-fix)

| Check | Result |
|-------|--------|
| `npm run lint` | ❌ **FAILS** — 1 error (`react-hooks/set-state-in-effect`, `Scoreboard.jsx:27`) |
| `npm test` | ✅ 66 pass — but components + `App` = **0% coverage** |
| `npm run build` | ✅ builds; **722 KB** (195 KB gzip), single chunk, >500 KB warning |
| `npm audit --omit=dev` (CI gate) | ✅ 0 vulnerabilities |
| `npm audit` (incl. dev) | ⚠️ 6 (5 high) — all in `vite`, dev-only |

## Priority summary

| # | Severity | Effort | Item |
|---|----------|--------|------|
| 1 | P1 | S | CI runs neither lint nor tests |
| 2 | P1 | S | `npm run lint` currently fails |
| 3 | P1 | M | README materially misdescribes the app (doc drift) |
| 4 | P2 | S | Self-collision counts the tail → unfair deaths |
| 5 | P2 | S | Corrupt `localStorage` → best score becomes `NaN` and sticks |
| 6 | P2 | M | Tests give false confidence (0% component cov; logic re-implemented) |
| 7 | P2 | M | 195 KB gzip bundle, single chunk, no splitting |
| 8 | P2 | S | `GameCanvas` leaks GPU resources on unmount |
| 9 | P3 | S | Dead assets committed / shipped (`hero.png`, `icons.svg`, …) |
| 10 | P3 | S | Dead code: `food.type`, `scoreRef` prop, `App.css`, reset fallback |
| 11 | P3 | S | `pool.js` comment says `400`; real value is `100` |
| 12 | P3 | S | Dev-dep vulnerabilities (`npm audit fix`) |
| 13 | P3 | S | CI audit gate is brittle (blocks deploy on any future prod CVE) |
| 14 | P3 | M | "Retina-crisp" claim false: fixed 200px buffer upscaled by CSS |
| 15 | P3 | S | Minor renderer allocations (per-frame `Vector3`, duplicate texture) |

---

## P1 — High

### 1. CI runs neither lint nor tests · Effort S
`.github/workflows/deploy.yml` runs only `npm ci`, `npm audit --omit=dev`, `npm run build`. The project has a 66-test Vitest suite and an ESLint config, but **neither gates deployment**. Broken code (see item 2) reaches `master` and production undetected. Highest-leverage fix in the repo.

**Fix:** add before the build step:
```yaml
- run: npm run lint
- run: npm test
```
Optionally split CI (lint+test on all pushes/PRs) from deploy (master only).

### 2. `npm run lint` currently fails · Effort S
```
Scoreboard.jsx:27  error  react-hooks/set-state-in-effect
  if (score > prevScoreRef.current) setFlashKey(k => k + 1);
```
Calling `setState` synchronously inside `useEffect` triggers a cascading render. It works today only because CI never lints. It also blocks item 1.

**Fix:** derive the flash from render instead of an effect, e.g. key the flashing `<span>` off `score` directly (`key={score}`) and drop the `flashKey`/effect pair, or compute the "increased" signal during render with a ref compare. Removes the state-in-effect entirely.

### 3. README materially misdescribes the app · Effort M
The last README update (`30a5151`) predates the cobra/mine redesign (`feec285`+), so it documents an app that no longer exists.

| README claims | Actual code (`GameCanvas.jsx`) |
|---------------|-------------------------------|
| 6 fruit types (apple, orange, …) | Single **mine** (spiked metallic sphere + blinking detonator) |
| Colour-matched particles per fruit | All particles fixed orange `0xff4400` |
| "Sandy desert ground plane" | Light-grey ground `0xd3d3d3` |
| Warm sun + ambient (`0xffe8c8`, …) | Red/orange lighting (`0xff5500`, `0xff3300`) |
| "Phong-shaded sphere segments" | Cobra-textured body + connectors + hood + eyes |
| Food-rendering section = "six SphereGeometry meshes" | One `mineGroup` |

Affects **Features**, **Architecture Overview**, and the **File-by-File** sections for `GameCanvas` and food. For a portfolio/demo repo the README is the primary artifact; being wrong is high-visibility.

**Fix:** rewrite the rendering/features sections to match the mine + cobra + grey-field reality. Consider a one-line "rendering is subject to change; see `GameCanvas.jsx`" to reduce future drift.

---

## P2 — Medium

### 4. Self-collision counts the tail → unfair deaths · Effort S
`useSnake.js` `tick()` checks all segments `[0 … len-1]` (including the current tail) **before** moving:
```js
for (let i = 0; i < snakeLen; i++) {
  const s = segPool[(headIdxRef.current + i) % POOL_SIZE];
  if (s.x === hx && s.y === hy) return die();
}
```
When the snake is **not** eating, the tail vacates its cell on the same tick, so moving the head into the old tail cell is legal in canonical Snake. Here it kills the player. Reproducible with any tail-follow maneuver at length ≥ 5.

**Fix:** exclude the tail when the target cell is not food:
```js
const willEat = hx === foodRef.current.x && hy === foodRef.current.y;
const checkLen = willEat ? snakeLen : snakeLen - 1;
for (let i = 0; i < checkLen; i++) { … }
```
(Start `i` at 1 too — index 0 is the current head and can never equal the moved head.)

### 5. Corrupt `localStorage` → best becomes `NaN` and sticks · Effort S
```js
return parseInt(localStorage.getItem('snakeBest') || '0', 10);
```
A non-numeric stored value (`'abc'`) is truthy, so `|| '0'` never fires and `parseInt` returns `NaN`. `best` renders as **"NaN"** in the Scoreboard, and because `newScore > NaN` is always `false`, best never recovers for the session. The existing test masks this by asserting `best === 0 || isNaN(best)`.

**Fix:**
```js
const n = parseInt(localStorage.getItem('snakeBest'), 10);
return Number.isFinite(n) && n >= 0 ? n : 0;
```
Tighten the test to assert `=== 0`.

### 6. Tests give false confidence · Effort M
- **0% component coverage.** `Scoreboard`, `LevelBar`, `Overlay`, `DPad`, `ErrorBoundary`, `GameCanvas`, and `App` have no tests (absent from the coverage report).
- **Logic is re-implemented, not imported.** `gameLogic.test.js` defines local copies of `isReversal`, `nextHead`, `isSelfCollision`, `levelForScore` and tests those. The real `tick()`, `randomFood`, and collision code are never asserted directly — the suite can stay green while the shipped code regresses. (It even encodes the item-4 tail-death behavior as "correct.")

**Fix:** export the pure helpers from source and import them in tests; add render tests for the presentational components (they're trivial and high-value); add a direct `randomFood` test (occupancy + null-on-full).

### 7. 195 KB gzip bundle, single chunk · Effort M
`import * as THREE from 'three'` (namespace import) plus no code-splitting produces one 722 KB / 195 KB-gzip chunk, above Vite's 500 KB warning. Heavy first paint for a Snake game on mobile/slow links — and at odds with the README's performance framing.

**Fix (choose one):** switch to named `three` imports; add `build.rollupOptions.output.manualChunks` to split three into its own cached chunk; or, if accepted as-is, raise `chunkSizeWarningLimit` so the warning is intentional, not ignored.

### 8. `GameCanvas` leaks GPU resources on unmount · Effort S
Cleanup calls only `renderer.dispose()`. The geometries (`bodyGeo`, `connGeo`, `headGeo`, cones, …), materials, and `CanvasTexture`s are never disposed — `renderer.dispose()` does not free them. One leak in production (minor), but one **per cycle** under StrictMode/dev or any remount.

**Fix:** in the cleanup, `scene.traverse` disposing `obj.geometry`, `obj.material` (and `material.map`), and dispose the shared geos/textures explicitly.

---

## P3 — Low

### 9. Dead assets committed / shipped · Effort S
`src/assets/hero.png` (44 KB), `react.svg`, `vite.svg` are unreferenced (Vite-template + unused hero). `public/icons.svg` (5 KB) is unreferenced yet **copied into `dist/` on every build**. Remove all four.

### 10. Dead code / vestigial fields · Effort S
- `randomFood` sets `.type = Math.floor(random()*6)` — never read anywhere (grep confirms; fruit-era vestige).
- `App.jsx` builds `scoreRef` and passes it to `GameCanvas`, which never reads it (suppressed by an `eslint-disable`).
- `App.css` contains only `/* reserved */` and is imported nowhere.
- `reset()` fallback branch is unreachable (board can't be full with a 3-segment snake) and buggy if it ran: `foodRef.current !== undefined` is always true, so it breaks after the first column and sets food without `.type`.

### 11. `pool.js` comment wrong · Effort S
`export const POOL_SIZE = COLS * ROWS;  // 400 — maximum possible snake length` — actual value is **100**. Fix the comment.

### 12. Dev-dependency vulnerabilities · Effort S
`npm audit` reports 6 (5 high), all in `vite` (e.g. `server.fs.deny` bypass), dev-only. Not in the prod bundle and not caught by the CI `--omit=dev` gate. Low real risk (dev server), but run `npm audit fix` to clear.

### 13. CI audit gate is brittle · Effort S
`npm audit --omit=dev` fails the **entire deploy** on any future CVE in a prod dep (react, three), even one irrelevant to a static client game. Prefer `npm audit --omit=dev --audit-level=high`, or move audit to a separate non-blocking job.

### 14. "Retina-crisp" claim is false · Effort M
`renderer.setSize(SIZE, SIZE, false)` fixes the drawing buffer at 200 px (× DPR) and lets CSS upscale it to the container (≤ 400 px). On a `dpr=1` desktop the board is ~2× upscaled → visibly soft, contradicting the README's high-DPI claim.

**Fix:** size the buffer to the actual displayed CSS pixels × `devicePixelRatio`, and update on resize (`ResizeObserver`).

### 15. Minor renderer allocations · Effort S
`cellToWorld` allocates a new `THREE.Vector3` for every segment every frame (≤ ~101/frame); `makeCobraBodyTexture()` is called twice, creating two identical textures. Negligible at this scale but contradicts the "zero-allocation" ethos the README emphasizes. Reuse a scratch vector; share the one body texture.

---

## What's solid (keep)

- Clean separation: all game state/logic in `useSnake`; components are thin and presentational.
- Ring-buffer segment pool is a genuine, well-documented zero-alloc win on the tick path.
- Direction queue correctly blocks the two-step 180° suicide (validates each dequeued turn against the live direction).
- `ErrorBoundary`, CSP meta tag, auto-pause on tab hide, `localStorage` write wrapped in try/catch.
- Level-up handles multi-threshold jumps; per-food boost persists correctly across pause/resume.
- Accessibility basics present: ARIA labels, `role="progressbar"`, `focus-visible` styles, contrast bumped for WCAG AA.

## Suggested order of execution

1. Items 1–2 (green CI + green lint) — unblocks everything and stops the bleeding.
2. Items 4–5 (two small, user-facing correctness bugs).
3. Item 3 (README truth).
4. Item 6 (tests that actually guard the code), then 7–8.
5. P3 cleanup as a single housekeeping pass.
