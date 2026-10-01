# Security Model

`snake-game` is a **100% client-side** static web app (React + Vite, deployed to
GitHub Pages). It has **no backend, no authentication, no user accounts, no
database, and makes no network requests**. This shapes what is — and isn't — a
security concern here.

## Scoring is client-authoritative by design

All game state (score, best, snake length, collision detection) is computed in
the browser. There is no server to validate it, so the score is **trivially
forgeable** — e.g. `localStorage.setItem('snakeBest', '999999')` in the console,
or editing state via React DevTools.

**This is acceptable** because nothing is at stake: there is no leaderboard, no
multiplayer, and no other player to defraud. A forged score only changes what the
local player sees on their own screen. Client-side "anti-cheat" would be security
theater and is intentionally not implemented.

> ⚠️ **If a leaderboard, multiplayer, or any shared/ranked scoring is ever added,
> the scoring model must move server-side.** Do not trust a client-submitted
> score. At minimum: validate scores with an authoritative server-side simulation
> or a signed, replayable input log; generate food positions server-side (client
> RNG is predictable); and rate-limit submissions per session.

## Content Security Policy

The app ships a restrictive CSP via a `<meta http-equiv>` tag in `index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none';
```

The app is fully self-contained (no CDNs, fonts, analytics, or external calls),
so `default-src 'self'` holds without exceptions. `'unsafe-inline'` is required
for `style-src` only because the UI uses inline `style` attributes; there is no
user-controlled style input, so the residual risk is negligible.

**Limitation:** `frame-ancestors` (anti-clickjacking) and `X-Frame-Options` are
ignored inside a `<meta>` tag — they require a real HTTP response header. GitHub
Pages does not support custom response headers, so they cannot be delivered from
this host. Clickjacking impact is nil here (the app performs no sensitive,
state-changing actions), but if the app is ever served from infrastructure that
can set headers, add `frame-ancestors 'none'` (or `X-Frame-Options: DENY`).

## Dependencies

- Production dependencies are audited in CI (`npm audit --omit=dev --audit-level=high`)
  and currently report **0 vulnerabilities**. That gate is the release blocker: it
  runs before `npm run build` in `.github/workflows/deploy.yml`, so a high or
  critical production advisory fails the deploy.
- Dev-only dependencies are **not** covered by that gate and are not shipped to the
  browser bundle — they run only on a developer machine or a CI runner. Advisories
  that surface under a plain `npm audit` but disappear under `--omit=dev` therefore
  cannot reach the deployed site. Fix them on their own merits, not as releng
  emergencies. (The dev tree was last cleaned in 2026-09 — undici, js-yaml,
  brace-expansion, @humanfs/node and vitest/@vitest/mocker; nothing enforces that,
  so run `npm audit` to check rather than trusting this sentence.)
- `.github/dependabot.yml` opens **weekly version-update PRs** (Mondays) for npm and
  GitHub Actions. npm minor/patch bumps are grouped into one dev and one prod PR;
  majors arrive as individual PRs. `vitest` and `@vitest/*` are always grouped
  together because they pin each other as exact peers. Security updates still come
  from the repository-level Dependabot setting, independent of this schedule.
- `package.json` forces two transitive versions through `overrides`: `undici`
  (`^7.30.0`) and `@babel/core` (`^7.29.6`). Both are floors, not exact pins, so
  patch and minor fixes still flow through. When an advisory is fixed in a newer
  version, raise the floor to it so a re-resolve cannot land on a vulnerable one.
- **Keep them as ranges.** `undici` was previously an exact pin at `7.28.0`, added to
  clear an advisory. Later advisories were patched in `7.29.0`, which the pin made
  unreachable — so the override became the reason the tree could not be fixed, and
  Dependabot's security-update run failed against it until #26 widened it to a caret
  range. An exact pin in `overrides` is a dependency that only a human can bump.
- **Bump vitest with npm 11.** From 4.1.11, `vitest` and `@vitest/coverage-v8`
  declare exact peer dependencies on each other. Moving the pair from 4.1.0 to 4.1.11
  crashed npm 10.9's arborist (`Cannot read properties of null (reading 'edgesOut')`)
  in `npm install`, `npm update` and `npm audit fix`; `npx npm@11 install` resolved it.
  Installs against the committed lockfile (`npm ci`, or `npm install` with no version
  change) work under npm 10, so CI and day-to-day installs are unaffected.

## Reporting

This is a demo/portfolio project with no production data. For any security
concern, please open an issue on the repository.
