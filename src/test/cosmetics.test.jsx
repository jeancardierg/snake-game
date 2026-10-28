/**
 * Cosmetics: catalog integrity, loadout persistence, and the pause menu's
 * Customize flow. Rendering of the items themselves needs WebGL and is
 * checked in the browser; here the hat/tail builders only have to produce
 * three.js groups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Group } from 'three';
import { SLOTS, DEFAULT_LOADOUT, LOADOUT_KEY, sanitizeLoadout, loadLoadout, saveLoadout, findItem, randomLoadout } from '../cosmetics/loadout';
import { FX } from '../cosmetics/boards';
import { Overlay } from '../components/Overlay';
import { Wardrobe } from '../components/Wardrobe';

describe('cosmetics catalog', () => {
  it('has unique ids and a name for every item', () => {
    for (const [slot, items] of Object.entries(SLOTS)) {
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size, slot).toBe(ids.length);
      for (const item of items) expect(item.name, `${slot}:${item.id}`).toBeTruthy();
    }
  });

  it('defaults to the original look', () => {
    expect(DEFAULT_LOADOUT).toEqual({ skin: 'coral', hat: 'none', tail: 'none', board: 'level' });
    for (const [slot, id] of Object.entries(DEFAULT_LOADOUT)) expect(findItem(slot, id)).toBeDefined();
    expect(findItem('skin', 'coral').builtin).toBe(true);
  });

  it('includes the Halloween and Easter sets', () => {
    expect(findItem('skin', 'bone').season).toBe('HALLOWEEN');
    expect(findItem('board', 'egghunt').season).toBe('EASTER');
    expect(findItem('hat', 'bunny').season).toBe('EASTER');
    expect(findItem('tail', 'chick').follower).toBe(true);
  });

  it('builds every hat and tail decoration as a three.js group', () => {
    for (const slot of ['hat', 'tail']) {
      for (const item of SLOTS[slot]) expect(item.build(), `${slot}:${item.id}`).toBeInstanceOf(Group);
    }
  });

  it('gives every board weather layer a known effect', () => {
    for (const b of SLOTS.board) if (b.fx) expect(FX[b.fx], b.id).toBeDefined();
  });
});

describe('loadout persistence', () => {
  beforeEach(() => localStorage.clear());

  it('replaces unknown or missing ids with the defaults', () => {
    expect(sanitizeLoadout({ skin: 'bone', hat: 'nope', board: 42 })).toEqual({ ...DEFAULT_LOADOUT, skin: 'bone' });
    expect(sanitizeLoadout(null)).toEqual(DEFAULT_LOADOUT);
    expect(sanitizeLoadout({ skin: '__proto__' })).toEqual(DEFAULT_LOADOUT);
  });

  it('round-trips through localStorage', () => {
    const picked = { skin: 'candy', hat: 'santa', tail: 'bell', board: 'snow' };
    saveLoadout(picked);
    expect(loadLoadout()).toEqual(picked);
  });

  it('shuffles to valid ids in every slot', () => {
    let seed = 0;
    for (let i = 0; i < 20; i++) {
      const l = randomLoadout(() => (seed = (seed + 0.37) % 1));
      expect(sanitizeLoadout(l)).toEqual(l);
    }
  });

  it('falls back to the default on corrupt storage', () => {
    localStorage.setItem(LOADOUT_KEY, '{not json');
    expect(loadLoadout()).toEqual(DEFAULT_LOADOUT);
  });
});

describe('pause menu Customize button', () => {
  it('opens the menu from the pause screen', () => {
    const onCustomize = vi.fn();
    render(<Overlay state="paused" score={0} levelIndex={0} banner={null} onPause={vi.fn()} onCustomize={onCustomize} />);
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(onCustomize).toHaveBeenCalledTimes(1);
  });

  it('hides Customize when no handler is wired in', () => {
    render(<Overlay state="paused" score={0} levelIndex={0} banner={null} />);
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull();
  });
});

describe('Wardrobe', () => {
  const open = (props = {}) => {
    const handlers = { onChange: vi.fn(), onShuffle: vi.fn(), onSave: vi.fn(), onClose: vi.fn(), onResume: vi.fn() };
    render(<Wardrobe loadout={DEFAULT_LOADOUT} levelIndex={0} dirty={false} {...handlers} {...props} />);
    return handlers;
  };

  it('marks the current picks and reports new ones per tab', () => {
    const { onChange } = open({ loadout: { ...DEFAULT_LOADOUT, skin: 'bone' } });
    expect(screen.getByRole('button', { name: /Bone Rattler/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Easter Egg/ }));
    expect(onChange).toHaveBeenCalledWith('skin', 'egg');

    fireEvent.click(screen.getByRole('tab', { name: 'Accessories' }));
    fireEvent.click(screen.getByRole('button', { name: /Witch Hat/ }));
    expect(onChange).toHaveBeenCalledWith('hat', 'witch');

    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByRole('button', { name: /Level Theme/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Graveyard/ }));
    expect(onChange).toHaveBeenCalledWith('board', 'graveyard');
  });

  it('offers Save only with unsaved picks, and says Discard instead of Close', () => {
    open();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('saves, shuffles and discards', () => {
    const h = open({ dirty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    expect(h.onShuffle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.onSave).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(h.onClose).toHaveBeenCalled();
  });

  it('keeps game keys away from the game and closes on Escape', () => {
    const h = open();
    const gameKey = vi.fn();
    window.addEventListener('keydown', gameKey);
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(gameKey).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.onClose).toHaveBeenCalled();
    window.removeEventListener('keydown', gameKey);
  });

  it('shows Resume only when there is a paused game', () => {
    open({ onResume: null });
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });
});
