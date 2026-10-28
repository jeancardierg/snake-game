/**
 * HomeScreenHelp — step-by-step "Add to Home Screen" dialog for iPhone.
 *
 * Opened by tapping the iPhone-only full screen tip in the bottom bar. iPhone
 * browsers can't go full screen from a web page, so installing to the Home
 * Screen is the only way. The Share button lives in a different place in
 * each browser, so the steps follow the browser in use.
 *
 * Props:
 *   onClose   function — closes the dialog
 *   userAgent string   — navigator.userAgent (prop so tests can pick a browser)
 */
import { useEffect } from 'react';
import { shareStep } from '../hints';

export function HomeScreenHelp({ onClose, userAgent = globalThis.navigator?.userAgent }) {
  // Esc closes; game keys must not reach useSnake's window listener meanwhile.
  useEffect(() => {
    const onKey = (e) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="ward-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-help-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div className="home-help">
        <h2 className="home-help-title" id="home-help-title">📲 Play full screen</h2>
        <p className="home-help-why">iPhone can't make a web page full screen, but the game can live on your Home Screen like an app.</p>
        <ol className="home-help-steps">
          <li>{shareStep(userAgent)}</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b>.</li>
          <li>Open <b>Snake</b> from your Home Screen. It plays full screen.</li>
        </ol>
        <button type="button" className="overlay-btn home-help-ok" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
