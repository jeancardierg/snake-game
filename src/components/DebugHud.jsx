/**
 * DebugHud — input latency and frame pacing readout, shown only with ?debug.
 *
 * Writes textContent from its own rAF loop instead of React state, so the
 * probe doesn't add re-renders to what it measures.
 */
import { useEffect, useRef } from 'react';
import { inputStats } from '../inputDebug';

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const max = (a) => (a.length ? Math.max(...a) : NaN);
const ms  = (v) => (Number.isFinite(v) ? `${Math.round(v)}ms` : '–');

export function DebugHud() {
  const ref = useRef(null);

  useEffect(() => {
    let raf, last = performance.now(), shown = last;
    let frames = 0, worst = 0;
    const loop = (now) => {
      const dt = now - last;
      last = now;
      frames++;
      if (dt > worst) worst = dt;
      if (now - shown >= 500 && ref.current) {
        const fps = (frames * 1000) / (now - shown);
        const { dispatch, wait } = inputStats;
        ref.current.textContent =
          `${Math.round(fps)} fps · worst frame ${ms(worst)} · dpr ${window.devicePixelRatio}\n` +
          `event→handler avg ${ms(avg(dispatch))} max ${ms(max(dispatch))}\n` +
          `queued→turn  avg ${ms(avg(wait))} max ${ms(max(wait))}`;
        shown = now; frames = 0; worst = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <pre ref={ref} className="debug-hud" aria-hidden="true" />;
}
