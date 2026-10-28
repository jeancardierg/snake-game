/**
 * inputDebug.js — on-device input latency probe, enabled with ?debug in the URL.
 *
 * Splits "the snake turns late" into its parts so they can be read on a real
 * phone (the sandbox has no iPhone):
 *   dispatch  event timestamp → our handler runs (browser / main-thread delay)
 *   wait      handler queues the turn → the tick applies it (grid quantization)
 * Frame pacing is measured by DebugHud itself.
 *
 * Every function is a no-op unless DEBUG, so the game pays nothing by default.
 */

export const DEBUG = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search);

const WINDOW = 20;                       // samples kept per metric
export const inputStats = { dispatch: [], wait: [] };
const queuedAt = [];                     // FIFO, mirrors useSnake's direction queue

const push = (arr, v) => { arr.push(v); if (arr.length > WINDOW) arr.shift(); };

/** Call at the top of an input handler with its DOM event. */
export function markInput(e) {
  if (!DEBUG || !e || !Number.isFinite(e.timeStamp)) return;
  // event.timeStamp shares performance.now()'s time origin in current browsers.
  const d = performance.now() - e.timeStamp;
  if (d >= 0 && d < 5000) push(inputStats.dispatch, d);
}

/** A direction entered useSnake's queue. */
export function markQueued() {
  if (DEBUG) queuedAt.push(performance.now());
}

/** The tick consumed the oldest queued direction. */
export function markDequeued() {
  if (!DEBUG || queuedAt.length === 0) return;
  push(inputStats.wait, performance.now() - queuedAt.shift());
}

/** The queue was dropped (autopilot, reset). */
export function clearQueued() {
  queuedAt.length = 0;
}
