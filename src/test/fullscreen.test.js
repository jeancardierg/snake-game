import { describe, it, expect, vi } from 'vitest';
import { isFullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange } from '../fullscreen';

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
