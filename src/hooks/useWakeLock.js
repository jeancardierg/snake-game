/**
 * useWakeLock.js — keeps the screen on while `active` is true.
 *
 * Uses the Screen Wake Lock API (Chrome / Edge / Android, Safari 16.4+,
 * Firefox 126+): no sleep, no dimming, no auto screen lock. Where the API is
 * missing it does nothing, and the device sleeps as usual.
 *
 * The browser drops the lock whenever the page is hidden (tab switch, app in
 * the background), so it is asked for again when the page comes back while
 * still active. A request can also be refused (low battery mode, permissions
 * policy); that is ignored.
 *
 * `nav` and `doc` are injectable so tests can pass fakes.
 */
import { useEffect } from 'react';

export function useWakeLock(active, nav = globalThis.navigator, doc = globalThis.document) {
  useEffect(() => {
    if (!active || !nav?.wakeLock || !doc) return;
    let sentinel = null;
    let pending = false;
    let done = false;

    const acquire = async () => {
      if (sentinel || pending || doc.visibilityState === 'hidden') return;
      pending = true;
      try {
        const s = await nav.wakeLock.request('screen');
        if (done) { s.release().catch(() => {}); return; }
        sentinel = s;
        // Released by the system (page hidden): forget it so it is re-asked.
        s.addEventListener?.('release', () => { if (sentinel === s) sentinel = null; });
      } catch {
        // Refused — the screen just follows the normal sleep timer.
      } finally {
        pending = false;
      }
    };

    const onVisibility = () => { if (doc.visibilityState === 'visible') acquire(); };

    acquire();
    doc.addEventListener('visibilitychange', onVisibility);
    return () => {
      done = true;
      doc.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active, nav, doc]);
}
