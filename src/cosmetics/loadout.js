/**
 * loadout.js — the player's chosen skin / hat / tail / food / board.
 *
 * Persisted in localStorage. Every read goes through sanitizeLoadout, so an
 * unknown id (an item renamed or removed in a later build, or a hand-edited
 * value) falls back to the default for that slot instead of breaking render.
 */
import { SKINS } from './skins';
import { HATS, TAILS } from './accessories';
import { BOARDS } from './boards';
import { FOODS } from './foods';

export const SLOTS = { skin: SKINS, hat: HATS, tail: TAILS, food: FOODS, board: BOARDS };

/** The original look: coral skin, nothing worn, the mine as food, per-level board colours. */
export const DEFAULT_LOADOUT = Object.freeze({ skin: 'coral', hat: 'none', tail: 'none', food: 'mine', board: 'level' });

export const LOADOUT_KEY = 'snake-loadout';

/** Item `id` of slot `slot`, or undefined. */
export function findItem(slot, id) {
  return SLOTS[slot]?.find((i) => i.id === id);
}

/** Copy of `raw` with every slot set to a known id (defaults fill the gaps). */
export function sanitizeLoadout(raw) {
  const out = { ...DEFAULT_LOADOUT };
  if (raw && typeof raw === 'object') {
    for (const slot of Object.keys(SLOTS)) {
      if (typeof raw[slot] === 'string' && findItem(slot, raw[slot])) out[slot] = raw[slot];
    }
  }
  return out;
}

/** A random item for every slot ('none' counts as a choice for hat and tail). */
export function randomLoadout(rand = Math.random) {
  const out = {};
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
