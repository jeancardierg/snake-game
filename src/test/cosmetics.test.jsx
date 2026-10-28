/**
 * Cosmetics: catalog integrity, loadout persistence, and the pause menu's
 * Customize flow. Rendering of the items themselves needs WebGL and is
 * checked in the browser; here the hat/tail builders only have to produce
 * three.js groups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Group } from 'three';
import { SLOTS, DEFAULT_LOADOUT, LOADOUT_KEY, sanitizeLoadout, loadLoadout, saveLoadout, findItem } from '../cosmetics/loadout';
import { FX } from '../cosmetics/boards';
import { Overlay } from '../components/Overlay';

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

  it('falls back to the default on corrupt storage', () => {
    localStorage.setItem(LOADOUT_KEY, '{not json');
    expect(loadLoadout()).toEqual(DEFAULT_LOADOUT);
  });
});

describe('pause menu Customize', () => {
  const paused = (props = {}) => render(
    <Overlay state="paused" score={0} levelIndex={0} banner={null} onPause={vi.fn()} loadout={DEFAULT_LOADOUT} onLoadout={vi.fn()} {...props} />,
  );

  it('opens the wardrobe from the pause screen and back', () => {
    paused();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getByText('CUSTOMIZE')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Skins' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
  });

  it('marks the current picks and reports new ones', () => {
    const onLoadout = vi.fn();
    paused({ loadout: { ...DEFAULT_LOADOUT, skin: 'bone' }, onLoadout });
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getByRole('button', { name: /Bone Rattler/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Easter Egg/ }));
    expect(onLoadout).toHaveBeenCalledWith('skin', 'egg');

    fireEvent.click(screen.getByRole('tab', { name: 'Accessories' }));
    fireEvent.click(screen.getByRole('button', { name: /Witch Hat/ }));
    expect(onLoadout).toHaveBeenCalledWith('hat', 'witch');

    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByRole('button', { name: /Level Theme/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Graveyard/ }));
    expect(onLoadout).toHaveBeenCalledWith('board', 'graveyard');
  });

  it('resumes straight from the wardrobe', () => {
    const onPause = vi.fn();
    paused({ onPause });
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('hides Customize when no loadout is wired in', () => {
    render(<Overlay state="paused" score={0} levelIndex={0} banner={null} />);
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull();
  });
});
