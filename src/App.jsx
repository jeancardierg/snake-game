/**
 * App — root component.
 *
 * Calls useSnake() and distributes the returned values to child components.
 * This is intentionally thin — all logic lives in the hook, all rendering
 * is delegated to the leaf components.
 *
 * Layout (top → bottom):
 *   <Scoreboard>   score | level badge | best
 *   <LevelBar>     progress bar to next level
 *   <board-slot>   flexible area; the board is the largest square that fits it
 *     <canvas-wrap>
 *       <GameCanvas> the game board
 *       <Overlay>    idle / paused (+ Customize) / dead screens (absolute, over the canvas)
 *   <DPad>         touch devices only
 *   controls-hint  keyboard shortcuts + Pause, Reset, Music, SFX, Customize, 2D/3D, mode, Autopilot and Full screen buttons
 *
 * Landscape phones switch to board-left / controls-right (see index.css).
 *
 * Touch controls: swipe on the canvas in any direction.
 * touchAction:'none' prevents the browser from scrolling while swiping.
 */
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useSnake } from './hooks/useSnake';
import { GameCanvas } from './components/GameCanvas';
import { Scoreboard } from './components/Scoreboard';
import { LevelBar } from './components/LevelBar';
import { Overlay } from './components/Overlay';
import { DPad } from './components/DPad';
import { SWIPE_THRESHOLD } from './constants';
import { swipeDir } from './swipe';
import { DEBUG, markInput } from './inputDebug';
import { DebugHud } from './components/DebugHud';
import { isMusicEnabled, setMusicEnabled } from './music';
import { isSfxEnabled, setSfxEnabled } from './audio';
import { Wardrobe } from './components/Wardrobe';
import { HomeScreenHelp } from './components/HomeScreenHelp';
import { loadLoadout, saveLoadout, randomLoadout } from './cosmetics/loadout';
import { DEFAULT_VIEW, turnSteering, loadLast3dView, saveLast3dView } from './cameraViews';
import { isFullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange, needsHomeScreenTip, HOME_SCREEN_TIP_KEY } from './fullscreen';
import './index.css';

export default function App() {
  // Saved look + camera view (see "Cosmetics" below). Read before useSnake:
  // the Chase cam view turns steering into turn left / turn right.
  const [saved, setSaved] = useState(loadLoadout);
  const turnSteer = turnSteering(saved.view);

  // All game state and actions come from a single hook
  const { headIdxRef, snakeLenRef, foodRef, obstaclesRef, score, best, levelIndex, state, banner, wrap, autopilot, assisted, steer, pause, reset, toggleWrap, toggleAutopilot } = useSnake({ turnSteering: turnSteer });

  // Mode can only change between runs — useSnake ignores the toggle otherwise.
  const runActive = state === 'running' || state === 'paused';

  // Ref mirror of state so GameCanvas's rAF loop can read it without a React
  // re-render. Updated synchronously after each render via useEffect.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Music toggle ────────────────────────────────────────────────────────────
  // music.js owns the preference (and its localStorage persistence); this is
  // just a mirror so the button label re-renders.
  const [musicOn, setMusicOn] = useState(isMusicEnabled);
  const toggleMusic = useCallback(() => {
    const next = !isMusicEnabled();
    setMusicEnabled(next);
    setMusicOn(next);
  }, []);

  // ── Sound effects toggle ────────────────────────────────────────────────────
  // Same pattern as music: audio.js owns the preference, this mirrors it.
  const [sfxOn, setSfxOn] = useState(isSfxEnabled);
  const toggleSfx = useCallback(() => {
    const next = !isSfxEnabled();
    setSfxEnabled(next);
    setSfxOn(next);
  }, []);

  // ── Full screen button (and F key) ──────────────────────────────────────────
  // Only shown where the browser supports element fullscreen (not iPhone
  // Safari: there, Add to Home Screen gives full screen via the manifest).
  // fsOn mirrors the document so Esc / the back gesture update the label.
  const fsSupported = isFullscreenSupported();
  const [fsOn, setFsOn] = useState(isFullscreen);
  useEffect(() => onFullscreenChange(() => setFsOn(isFullscreen())), []);
  useEffect(() => {
    if (!fsSupported) return;
    const onKey = (e) => {
      if ((e.key === 'f' || e.key === 'F') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fsSupported]);

  // iPhone has no fullscreen button, so point at Add to Home Screen instead.
  // Hidden once closed (remembered on the device) or when already installed.
  const [homeTip, setHomeTip] = useState(() => {
    try { if (localStorage.getItem(HOME_SCREEN_TIP_KEY)) return false; } catch { /* storage blocked */ }
    return needsHomeScreenTip();
  });
  const closeHomeTip = useCallback(() => {
    setHomeTip(false);
    try { localStorage.setItem(HOME_SCREEN_TIP_KEY, '1'); } catch { /* storage blocked */ }
  }, []);
  // Tapping the tip opens step-by-step instructions (pauses a running game).
  const [homeHelp, setHomeHelp] = useState(false);
  const openHomeHelp  = useCallback(() => { if (state === 'running') pause(); setHomeHelp(true); }, [state, pause]);
  const closeHomeHelp = useCallback(() => setHomeHelp(false), []);

  // Touch device: start-screen instructions talk about swipes and the D-pad
  // instead of keys. Read once; the pointer type doesn't change mid-session.
  const [touch] = useState(() => Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches));

  // ── Cosmetics (Customize menu) ──────────────────────────────────────────────
  // `saved` is what's stored on the device; `draft` is the menu's working copy
  // (null when the menu is closed). The board shows the draft while the menu is
  // open; only Save makes it stick.
  const [draft, setDraft] = useState(null);
  const editing = draft !== null && state !== 'running';
  const loadout = editing ? draft : saved;
  const openWardrobe = useCallback(() => {
    if (state === 'running') pause();
    setDraft({ ...saved });
  }, [state, pause, saved]);
  const closeWardrobe = useCallback(() => setDraft(null), []);
  const changeDraft   = useCallback((slot, id) => setDraft((d) => ({ ...d, [slot]: id })), []);
  const shuffleDraft  = useCallback(() => setDraft((d) => randomLoadout(Math.random, d.view)), []);
  const saveDraft     = useCallback(() => { saveLoadout(draft); saveLast3dView(draft.view); setSaved(draft); }, [draft]);

  // ── 2D / 3D button (and V key) ──────────────────────────────────────────────
  // Flips between Top-down and the last 3D view picked in Customize, and saves
  // right away like the Music and Walls/Wrap buttons.
  const toggleView = useCallback(() => {
    const next = { ...saved, view: saved.view === DEFAULT_VIEW ? loadLast3dView() : DEFAULT_VIEW };
    saveLoadout(next);
    setSaved(next);
  }, [saved]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'v' || e.key === 'V') && draft === null && !e.repeat) toggleView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleView, draft]);
  const resumeFromWardrobe = useCallback(() => { setDraft(null); pause(); }, [pause]);
  const dirty = editing && Object.keys(saved).some((k) => saved[k] !== draft[k]);

  // ── Swipe gesture detection ─────────────────────────────────────────────────
  // A swipe steers as soon as the finger has travelled SWIPE_THRESHOLD px, not
  // when it lifts: waiting for touchend added the whole rest of the gesture to
  // the input delay. After each steer the origin moves to the finger, so one
  // continuous L-shaped stroke can queue two turns. The same direction is not
  // re-fired within a gesture (it would be a second turn in Chase cam).
  // A ref keeps the handlers stable and out of React state.
  const swipe = useRef(null);   // { x, y, last } for the active touch

  const handleSwipeStart = useCallback((e) => {
    if (!e.touches.length) return;  // touchstart always has ≥1 touch, but guard defensively
    // Record only the first touch point (identifier 0 in multi-touch scenarios)
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY, last: null };
  }, []);

  const trackSwipe = useCallback((e, t) => {
    const g = swipe.current;
    if (!g || !t) return;
    const dir = swipeDir(t.clientX - g.x, t.clientY - g.y, SWIPE_THRESHOLD);
    if (!dir) return;
    g.x = t.clientX;
    g.y = t.clientY;
    if (dir === g.last) return;
    g.last = dir;
    markInput(e);
    steer(dir);
  }, [steer]);

  const handleSwipeMove = useCallback((e) => trackSwipe(e, e.touches[0]), [trackSwipe]);

  // A flick can lift before any touchmove crossed the threshold.
  const handleSwipeEnd = useCallback((e) => {
    trackSwipe(e, e.changedTouches[0]);
    swipe.current = null;
  }, [trackSwipe]);

  const handleSwipeCancel = useCallback(() => { swipe.current = null; }, []);

  // ── Board-width publisher ─────────────────────────────────────────────────
  // The board is sized in CSS from its slot (min of width, height and a cap),
  // so its width isn't known to the header/controls. Publish it as --board-w on
  // .app so those rows line up with the board edges at every viewport size.
  const appRef   = useRef(null);
  const boardRef = useRef(null);
  useLayoutEffect(() => {
    const app = appRef.current, board = boardRef.current;
    if (!app || !board || typeof ResizeObserver === 'undefined') return;
    const publish = () => app.style.setProperty('--board-w', `${Math.round(board.getBoundingClientRect().width)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(board);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="app" ref={appRef}>
      {/* Top bar: score + level badge + best */}
      <Scoreboard score={score} best={best} levelIndex={levelIndex} state={state} onPause={pause} />

      {/* Progress bar toward next speed level */}
      <LevelBar score={score} levelIndex={levelIndex} />

      {/* Game board — canvas + overlay stacked via position:absolute.
          Swipe handlers live here so the full board area responds to gestures.
          touchAction:'none' tells the browser not to scroll or zoom while the
          player's finger is on the canvas. */}
      <div className="board-slot">
        <div
          ref={boardRef}
          className="canvas-wrap"
          onTouchStart={handleSwipeStart}
          onTouchMove={handleSwipeMove}
          onTouchEnd={handleSwipeEnd}
          onTouchCancel={handleSwipeCancel}
          style={{ touchAction: 'none' }}
        >
          <GameCanvas
            headIdxRef={headIdxRef}
            snakeLenRef={snakeLenRef}
            foodRef={foodRef}
            obstaclesRef={obstaclesRef}
            levelIndex={levelIndex}
            stateRef={stateRef}
            wrap={wrap}
            loadout={loadout}
          />
          <Overlay
            state={state}
            score={score}
            levelIndex={levelIndex}
            banner={banner}
            onReset={reset}
            onPause={pause}
            onCustomize={openWardrobe}
            assisted={assisted}
            touch={touch}
            wrap={wrap}
            turn={turnSteer}
          />
        </div>
      </div>

      {/* Customize menu: full-screen dialog over everything */}
      {editing && (
        <Wardrobe
          loadout={draft}
          levelIndex={levelIndex}
          dirty={dirty}
          onChange={changeDraft}
          onShuffle={shuffleDraft}
          onSave={saveDraft}
          onClose={closeWardrobe}
          onResume={state === 'paused' ? resumeFromWardrobe : null}
        />
      )}

      {homeHelp && <HomeScreenHelp onClose={closeHomeHelp} />}

      {DEBUG && <DebugHud />}

      {/* Mobile D-Pad (hidden on desktop via CSS media query) */}
      <DPad onDir={steer} levelIndex={levelIndex} turn={turnSteer} />

      {/* Keyboard hint + quick-action buttons */}
      <div className="controls-hint">
        <span>{turnSteer ? 'A / D / ◀ ▶ turn · Swipe' : 'WASD / Arrows / Swipe'}</span>
        <button className="ctrl-btn" onClick={pause}>
          {state === 'paused' ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button className="ctrl-btn" onClick={reset}>↺ Reset</button>
        <button
          className="ctrl-btn"
          onClick={toggleMusic}
          aria-pressed={musicOn}
          aria-label={musicOn ? 'Mute music' : 'Unmute music'}
        >
          {musicOn ? '🔊 Music' : '🔇 Music'}
        </button>
        <button
          className="ctrl-btn"
          onClick={toggleSfx}
          aria-pressed={sfxOn}
          aria-label={sfxOn ? 'Mute sound effects' : 'Unmute sound effects'}
        >
          {sfxOn ? '🔔 SFX' : '🔕 SFX'}
        </button>
        <button className="ctrl-btn" onClick={openWardrobe}>🎨 Customize</button>
        <button
          className="ctrl-btn"
          onClick={toggleView}
          aria-pressed={saved.view !== DEFAULT_VIEW}
          aria-label={saved.view === DEFAULT_VIEW ? 'Switch to 3D view' : 'Switch to 2D view'}
          title="Pick the 3D view in Customize → View (V)"
        >
          {saved.view === DEFAULT_VIEW ? '▦ 2D' : '🧊 3D'}
        </button>
        <button
          className="ctrl-btn"
          onClick={toggleWrap}
          disabled={runActive}
          aria-pressed={wrap}
          aria-label={wrap ? 'Switch to classic walls' : 'Switch to wrap-around walls'}
          title={runActive ? 'Mode can be changed before a run or after game over' : undefined}
        >
          {wrap ? '🌀 Wrap' : '🧱 Walls'}
        </button>
        <button
          className="ctrl-btn"
          onClick={toggleAutopilot}
          aria-pressed={autopilot}
          aria-label={autopilot ? 'Turn autopilot off' : 'Turn autopilot on'}
          title="The snake steers itself. Steer to take over. Runs that use autopilot don't set a best score."
        >
          {autopilot ? '🤖 Auto: on' : '🤖 Auto: off'}
        </button>
        {fsSupported && (
          <button
            className="ctrl-btn"
            onClick={() => toggleFullscreen()}
            aria-pressed={fsOn}
            aria-label={fsOn ? 'Exit full screen' : 'Enter full screen'}
            title="Full screen (F)"
          >
            {fsOn ? '⤡ Exit full' : '⛶ Full screen'}
          </button>
        )}
        {homeTip && (
          <p className="home-tip" role="note">
            <button className="home-tip-open" onClick={openHomeHelp}>📲 Play full screen: Add to Home Screen · <u>How?</u></button>
            <button className="home-tip-close" onClick={closeHomeTip} aria-label="Hide tip">✕</button>
          </p>
        )}
      </div>
    </div>
  );
}
