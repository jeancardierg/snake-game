import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWakeLock } from '../hooks/useWakeLock';

/** Fake navigator.wakeLock + document; sentinels record their release. */
function fakes() {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const sentinels = [];
  const request = vi.fn(async () => {
    const s = new EventTarget();
    s.released = false;
    s.release = vi.fn(async () => { s.released = true; s.dispatchEvent(new Event('release')); });
    sentinels.push(s);
    return s;
  });
  return { nav: { wakeLock: { request } }, doc, request, sentinels };
}

const flush = () => act(async () => {});

describe('useWakeLock', () => {
  it('holds the lock while active and releases it when inactive', async () => {
    const { nav, doc, request, sentinels } = fakes();
    const { rerender } = renderHook(({ on }) => useWakeLock(on, nav, doc), { initialProps: { on: false } });
    await flush();
    expect(request).not.toHaveBeenCalled();

    rerender({ on: true });
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    expect(sentinels[0].released).toBe(false);

    rerender({ on: false });
    await flush();
    expect(sentinels[0].released).toBe(true);
  });

  it('re-acquires after the page is hidden and shown again', async () => {
    const { nav, doc, request, sentinels } = fakes();
    renderHook(() => useWakeLock(true, nav, doc));
    await flush();
    // Browser drops the lock on hide.
    doc.visibilityState = 'hidden';
    await act(async () => { sentinels[0].release(); doc.dispatchEvent(new Event('visibilitychange')); });
    expect(request).toHaveBeenCalledTimes(1);

    doc.visibilityState = 'visible';
    await act(async () => { doc.dispatchEvent(new Event('visibilitychange')); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels[1].released).toBe(false);
  });

  it('releases a lock that resolves after the game already stopped', async () => {
    const { nav, doc, sentinels } = fakes();
    const { unmount } = renderHook(() => useWakeLock(true, nav, doc));
    unmount(); // before the request promise settles
    await flush();
    expect(sentinels[0].released).toBe(true);
  });

  it('does nothing without the API or when refused', async () => {
    const { doc } = fakes();
    expect(() => renderHook(() => useWakeLock(true, {}, doc))).not.toThrow();
    const nav = { wakeLock: { request: vi.fn(async () => { throw new Error('NotAllowedError'); }) } };
    renderHook(() => useWakeLock(true, nav, doc));
    await flush();
    expect(nav.wakeLock.request).toHaveBeenCalled();
  });
});
