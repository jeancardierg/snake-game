/**
 * Wardrobe — the Customize menu: skins, hats, tail decorations and boards,
 * opened from the pause screen or the bottom bar. A full-screen dialog with a
 * live 3D preview on top; picks are a draft until Save writes them to the
 * device (see App), and closing without saving drops them.
 *
 * Props:
 *   loadout     object    — draft { skin, hat, tail, board } item ids
 *   levelIndex  number    — current level (accent colour, 'Level Theme' look)
 *   dirty       boolean   — draft differs from the saved loadout
 *   onChange    function  — (slot, id) when a tile is picked
 *   onShuffle   function  — random pick in every slot
 *   onSave      function  — persist the draft
 *   onClose     function  — close (unsaved picks are dropped)
 *   onResume    function  — close and resume; null when there's no game to resume
 */
import { useEffect, useMemo, useState } from 'react';
import { WardrobePreview } from './WardrobePreview';
import { getLevel } from '../levels';
import { SKINS } from '../cosmetics/skins';
import { HATS, TAILS } from '../cosmetics/accessories';
import { BOARDS } from '../cosmetics/boards';
import { skinSwatch, boardThumb, accessoryThumbs } from '../cosmetics/thumbs';

const TABS = [
  { id: 'skin',  label: 'Skins' },
  { id: 'acc',   label: 'Accessories' },
  { id: 'board', label: 'Board' },
];

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

function Chip({ item }) {
  if (item.season) return <span className={`ward-chip ward-chip-${item.season.toLowerCase()}`}>{item.season}</span>;
  if (item.tag)    return <span className="ward-chip">{item.tag}</span>;
  return null;
}

function Tile({ slot, item, selected, onChange, children }) {
  return (
    <button
      type="button"
      className="ward-tile"
      aria-pressed={selected}
      onClick={() => onChange(slot, item.id)}
    >
      {children}
      <span className="ward-name">{item.name}</span>
      <Chip item={item} />
    </button>
  );
}

function Group({ label, children }) {
  return (
    <section className="ward-group">
      <h3 className="ward-group-label">{label}</h3>
      <div className="ward-tiles">{children}</div>
    </section>
  );
}

function Thumb({ url }) {
  return url
    ? <span className="ward-swatch ward-thumb" style={{ backgroundImage: `url(${url})` }} />
    : <span className="ward-swatch ward-empty" aria-hidden="true">∅</span>;
}

export function Wardrobe({ loadout, levelIndex, dirty, onChange, onShuffle, onSave, onClose, onResume }) {
  const [tab, setTab] = useState('skin');
  const [savedNote, setSavedNote] = useState(false);

  // Game keys (P, arrows, WASD, Enter/Space) must not reach the game while the
  // menu is open: useSnake listens on window, so stop them in the capture phase.
  // Esc closes the menu. Buttons keep their own Enter/Space activation.
  useEffect(() => {
    const GAME_KEYS = new Set(['p', 'P', 'w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); return; }
      if (GAME_KEYS.has(e.key) || e.key === 'Enter' || e.key === ' ') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (!savedNote) return;
    const t = setTimeout(() => setSavedNote(false), 1600);
    return () => clearTimeout(t);
  }, [savedNote]);
  const save = () => { onSave(); setSavedNote(true); };
  const level = getLevel(Math.max(levelIndex ?? 0, 0));
  // Rendered once per page load (cached in thumbs.js); empty under jsdom.
  const thumbs = useMemo(() => (tab === 'acc' ? accessoryThumbs() : {}), [tab]);

  const skinTile = (s) => (
    <Tile key={s.id} slot="skin" item={s} selected={loadout.skin === s.id} onChange={onChange}>
      <span className="ward-swatch ward-skin" style={{ backgroundImage: skinSwatch(s) ? `url(${skinSwatch(s)})` : undefined }}>
        <i style={{ background: hex(s.head.color) }} />
      </span>
    </Tile>
  );

  return (
    // Touches stay inside the menu: the board's swipe handler would otherwise
    // read a scroll through the tiles as a turn queued for when play resumes.
    <div className="ward-modal" role="dialog" aria-modal="true" aria-labelledby="ward-title">
    <div
      className="ward"
      style={{ '--ward-accent': level.color }}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div className="ward-head">
        <h2 className="ward-title" id="ward-title">CUSTOMIZE</h2>
        <button type="button" className="ward-back" onClick={onClose}>{dirty ? 'Discard' : 'Close'}</button>
      </div>
      <WardrobePreview loadout={loadout} levelIndex={levelIndex} />
      <div className="ward-tabs" role="tablist" aria-label="Customize">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ward-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`ward-panel-${t.id}`}
            className="ward-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ward-body" role="tabpanel" id={`ward-panel-${tab}`} aria-labelledby={`ward-tab-${tab}`}>
        {tab === 'skin' && ['Halloween', 'Seasonal', 'Signature'].map((g) => (
          <Group key={g} label={g}>{SKINS.filter((s) => s.group === g).map(skinTile)}</Group>
        ))}
        {tab === 'acc' && (
          <>
            <Group label="Hat">
              {HATS.map((h) => (
                <Tile key={h.id} slot="hat" item={h} selected={loadout.hat === h.id} onChange={onChange}>
                  <Thumb url={thumbs[`hat:${h.id}`]} />
                </Tile>
              ))}
            </Group>
            <Group label="Tail">
              {TAILS.map((t) => (
                <Tile key={t.id} slot="tail" item={t} selected={loadout.tail === t.id} onChange={onChange}>
                  <Thumb url={thumbs[`tail:${t.id}`]} />
                </Tile>
              ))}
            </Group>
          </>
        )}
        {tab === 'board' && ['Seasonal', 'Signature'].map((g) => (
          <Group key={g} label={g}>
            {BOARDS.filter((b) => b.group === g).map((b) => (
              <Tile key={b.id} slot="board" item={b} selected={loadout.board === b.id} onChange={onChange}>
                <Thumb url={boardThumb(b, level.theme)} />
              </Tile>
            ))}
          </Group>
        ))}
      </div>

      <div className="ward-foot">
        <button type="button" className="ward-btn" onClick={onShuffle}>Shuffle</button>
        <button type="button" className="ward-btn ward-save" onClick={save} disabled={!dirty && !savedNote} aria-live="polite">
          {savedNote ? 'Saved ✓' : 'Save'}
        </button>
        {onResume && (
          <button type="button" className="ward-btn ward-primary" onClick={onResume} style={{ background: level.color }}>Resume</button>
        )}
      </div>
      {dirty && <p className="ward-note">Unsaved: press Save to keep these picks on this device.</p>}
    </div>
    </div>
  );
}
