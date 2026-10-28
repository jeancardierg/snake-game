/**
 * fullscreen.js — thin wrapper over the Fullscreen API.
 *
 * Covers the standard API and the webkit-prefixed one (Safari on iPad / macOS
 * before 16.4). iPhone Safari has no element fullscreen at all, so there
 * `isFullscreenSupported()` is false and the button is hidden; iPhone players
 * get full screen by adding the game to the Home Screen instead (see the web
 * app manifest and the apple-mobile-web-app-* meta tags in index.html).
 *
 * Every function takes the document as an optional argument so tests can pass
 * a fake one.
 */

/** True when the page can ask for element fullscreen. */
export function isFullscreenSupported(doc = globalThis.document) {
  if (!doc) return false;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

/** True while any element is fullscreen. */
export function isFullscreen(doc = globalThis.document) {
  if (!doc) return false;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/**
 * Enter fullscreen on the whole page, or leave it. Must run inside a user
 * gesture (a click), or the browser refuses. Never throws: a refusal (iframe
 * without allow="fullscreen", user setting, etc.) just leaves the page as is.
 */
export async function toggleFullscreen(doc = globalThis.document) {
  if (!doc) return;
  try {
    if (isFullscreen(doc)) {
      await (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
    } else {
      const el = doc.documentElement;
      // navigationUI:'hide' asks Android Chrome to hide its bars too.
      await (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
    }
  } catch {
    // Refused — nothing to undo.
  }
}

/**
 * Calls `cb` whenever fullscreen starts or ends (including the user leaving
 * with Esc or the system back gesture). Returns an unsubscribe function.
 */
export function onFullscreenChange(cb, doc = globalThis.document) {
  if (!doc) return () => {};
  doc.addEventListener('fullscreenchange', cb);
  doc.addEventListener('webkitfullscreenchange', cb);
  return () => {
    doc.removeEventListener('fullscreenchange', cb);
    doc.removeEventListener('webkitfullscreenchange', cb);
  };
}
