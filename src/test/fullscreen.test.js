import { describe, it, expect, vi } from 'vitest';
import { isFullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange, needsHomeScreenTip } from '../fullscreen';

/** Minimal document stand-in; `prefix` switches to the webkit names. */
function fakeDoc({ enabled = true, prefix = false } = {}) {
  const doc = new EventTarget();
  const el = {};
  doc.documentElement = el;
  const enter = vi.fn(async () => { doc[prefix ? 'webkitFullscreenElement' : 'fullscreenElement'] = el; });
  const exit  = vi.fn(async () => { doc[prefix ? 'webkitFullscreenElement' : 'fullscreenElement'] = null; });
  if (prefix) {
    doc.webkitFullscreenEnabled = enabled;
    el.webkitRequestFullscreen = enter;
    doc.webkitExitFullscreen = exit;
  } else {
    doc.fullscreenEnabled = enabled;
    el.requestFullscreen = enter;
    doc.exitFullscreen = exit;
  }
  return { doc, enter, exit };
}

describe('fullscreen', () => {
  it('detects support, standard and webkit', () => {
    expect(isFullscreenSupported(fakeDoc().doc)).toBe(true);
    expect(isFullscreenSupported(fakeDoc({ prefix: true }).doc)).toBe(true);
    expect(isFullscreenSupported(fakeDoc({ enabled: false }).doc)).toBe(false);
    expect(isFullscreenSupported({})).toBe(false); // iPhone Safari: no API at all
  });

  it.each([false, true])('toggles in and out (webkit prefix: %s)', async (prefix) => {
    const { doc, enter, exit } = fakeDoc({ prefix });
    await toggleFullscreen(doc);
    expect(enter).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(isFullscreen(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(exit).toHaveBeenCalled();
    expect(isFullscreen(doc)).toBe(false);
  });

  it('swallows a refused request', async () => {
    const { doc } = fakeDoc();
    doc.documentElement.requestFullscreen = () => Promise.reject(new TypeError('denied'));
    await expect(toggleFullscreen(doc)).resolves.toBeUndefined();
    expect(isFullscreen(doc)).toBe(false);
  });

  it('reports changes from both event names until unsubscribed', () => {
    const { doc } = fakeDoc();
    const cb = vi.fn();
    const off = onFullscreenChange(cb, doc);
    doc.dispatchEvent(new Event('fullscreenchange'));
    doc.dispatchEvent(new Event('webkitfullscreenchange'));
    off();
    doc.dispatchEvent(new Event('fullscreenchange'));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('needsHomeScreenTip', () => {
  const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const win = ({ ua, standalone = false, mode = 'browser', fs = false }) => ({
    navigator: { userAgent: ua, standalone },
    matchMedia: (q) => ({ matches: q === `(display-mode: ${mode})` }),
    document: { fullscreenEnabled: fs },
  });

  it('shows in iPhone Safari and iPhone Chrome', () => {
    expect(needsHomeScreenTip(win({ ua: IPHONE_SAFARI }))).toBe(true);
    expect(needsHomeScreenTip(win({ ua: IPHONE_CHROME }))).toBe(true);
  });

  it('hides once launched from the Home Screen', () => {
    expect(needsHomeScreenTip(win({ ua: IPHONE_SAFARI, standalone: true }))).toBe(false);
    expect(needsHomeScreenTip(win({ ua: IPHONE_SAFARI, mode: 'standalone' }))).toBe(false);
  });

  it('hides off iPhone, or if iPhone ever gains the Fullscreen API', () => {
    expect(needsHomeScreenTip(win({ ua: ANDROID }))).toBe(false);
    expect(needsHomeScreenTip(win({ ua: IPHONE_SAFARI, fs: true }))).toBe(false);
    expect(needsHomeScreenTip(undefined)).toBe(false);
  });
});
