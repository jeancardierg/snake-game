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
  and currently report **0 vulnerabilities**.
- Dev-only dependencies are updated via Dependabot; they are not shipped to the
  browser bundle.

## Reporting

This is a demo/portfolio project with no production data. For any security
concern, please open an issue on the repository.
