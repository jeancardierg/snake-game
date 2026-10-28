/**
 * hints.js — player-facing instruction text that depends on the device.
 * Pure, so tests can pick the device; components import from here.
 */

/** "How to start" line for the idle screen, by input and steering mode. */
export function startHint({ touch, turn }) {
  if (touch) return turn ? 'Tap ◀ ▶ or swipe left / right to start' : 'Swipe or tap an arrow to start';
  return turn ? 'Press A / D or ◀ ▶ to start' : 'Press an arrow key or WASD to start';
}

/** Share-button location for the browser in `ua`. */
export function shareStep(ua = '') {
  if (/CriOS/.test(ua)) return 'Tap the Share button (square with an arrow ↑) in the address bar, or ⋯ → Share.';
  if (/FxiOS/.test(ua)) return 'Tap the menu ☰, then Share.';
  if (/EdgiOS/.test(ua)) return 'Tap the menu ⋯, then Share.';
  return 'Tap the Share button (square with an arrow ↑). On newer iOS it is inside the ⋯ menu.';
}
