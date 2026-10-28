/**
 * loadout.js — the player's chosen skin / hat / tail / food / board, and camera view.
 *
 * Persisted in localStorage. Every read goes through sanitizeLoadout, so an
 * unknown id (an item renamed or removed in a later build, or a hand-edited
 * value) falls back to the default for that slot instead of breaking render.
 */
import { SKINS } from './skins';
import { HATS, TAILS } from './accessories';
import { BOARDS } from './boards';
import { FOODS } from './foods';
import { VIEWS, DEFAULT_VIEW } from '../cameraViews';

export const SLOTS = { skin: SKINS, hat: HATS, tail: TAILS, food: FOODS, board: BOARDS };
// The camera view is saved with the look but is not a cosmetic: Shuffle leaves it alone.
const PICKS = { ...SLOTS, view: VIEWS };

/** The original look: coral skin, nothing worn, the mine as food, per-level board colours, top-down. */
export const DEFAULT_LOADOUT = Object.freeze({ skin: 'coral', hat: 'none', tail: 'none', food: 'mine', board: 'level', view: DEFAULT_VIEW });

export const LOADOUT_KEY = 'snake-loadout';

/** Item `id` of slot `slot`, or undefined. */
export function findItem(slot, id) {
  return PICKS[slot]?.find((i) => i.id === id);
}

/** Copy of `raw` with every slot set to a known id (defaults fill the gaps). */
export function sanitizeLoadout(raw) {
  const out = { ...DEFAULT_LOADOUT };
  if (raw && typeof raw === 'object') {
    for (const slot of Object.keys(PICKS)) {
      if (typeof raw[slot] === 'string' && findItem(slot, raw[slot])) out[slot] = raw[slot];
    }
  }
  return out;
}

/** A random item for every cosmetic slot ('none' counts as a choice for hat and tail); view is `view`. */
export function randomLoadout(rand = Math.random, view = DEFAULT_VIEW) {
  const out = { view };
  for (const [slot, items] of Object.entries(SLOTS)) out[slot] = items[Math.floor(rand() * items.length)].id;
  return out;
}

/** Stored loadout, or the default. Never throws. */
export function loadLoadout() {
  try {
    return sanitizeLoadout(JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_LOADOUT };
  }
}

/** Persist `loadout`. Never throws (private mode / blocked storage). */
export function saveLoadout(loadout) {
  try {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(sanitizeLoadout(loadout)));
  } catch { /* storage unavailable: the choice lasts for this session only */ }
}
