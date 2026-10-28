/**
 * Customize flow through App: open from the bottom bar, pick, Save persists to
 * the device, closing without Save drops the picks. GameCanvas needs WebGL, so
 * it is replaced by a stub that shows the loadout it is asked to draw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LOADOUT_KEY } from '../cosmetics/loadout';

vi.mock('../components/GameCanvas', () => ({
  GameCanvas: ({ loadout }) => <div data-testid="board">{`${loadout.skin}/${loadout.hat}/${loadout.tail}/${loadout.food}/${loadout.board}`}</div>,
}));

const { default: App } = await import('../App');
const stored = () => JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? 'null');

describe('Customize from the bottom bar', () => {
  beforeEach(() => localStorage.clear());

  it('applies picks live, persists them only on Save', () => {
    render(<App />);
    expect(screen.getByTestId('board')).toHaveTextContent('coral/none/none/mine/level');

    fireEvent.click(screen.getByRole('button', { name: '🎨 Customize' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bone Rattler/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Food' }));
    fireEvent.click(screen.getByRole('button', { name: /Jack-o'-Lantern/ }));
    expect(screen.getByTestId('board')).toHaveTextContent('bone/none/none/pumpkin/level');
    expect(stored()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(stored()).toEqual({ skin: 'bone', hat: 'none', tail: 'none', food: 'pumpkin', board: 'level' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('board')).toHaveTextContent('bone/none/none/pumpkin/level');
  });

  it('drops unsaved picks when closed', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '🎨 Customize' }));
    fireEvent.click(screen.getByRole('button', { name: /Candy Cane/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByTestId('board')).toHaveTextContent('coral/none/none/mine/level');
    expect(stored()).toBeNull();
  });
});
