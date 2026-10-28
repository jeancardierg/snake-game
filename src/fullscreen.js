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

/** localStorage key set once the player closes the Home Screen tip. */
export const HOME_SCREEN_TIP_KEY = 'snakeHomeScreenTipDismissed';

/**
 * True on iPhone / iPod (any browser: Chrome, Firefox etc. there all use
 * Safari's engine, so none has element fullscreen) when the game is not
 * already running from the Home Screen. iPad is excluded: it has the API.
 */
export function needsHomeScreenTip(win = globalThis.window) {
  if (!win?.navigator) return false;
  const nav = win.navigator;
  if (!/iPhone|iPod/.test(nav.userAgent ?? '')) return false;
  const installed = nav.standalone === true
    || Boolean(win.matchMedia?.('(display-mode: standalone)').matches)
    || Boolean(win.matchMedia?.('(display-mode: fullscreen)').matches);
  return !installed && !isFullscreenSupported(win.document);
}
