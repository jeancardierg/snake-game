/**
 * Device-aware instructions: start-screen how-to (touch vs keyboard, walls vs
 * wrap, turn steering) and the iPhone Add to Home Screen dialog.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { startHint, shareStep } from '../hints';
import { Overlay } from '../components/Overlay';
import { HomeScreenHelp } from '../components/HomeScreenHelp';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';

describe('startHint', () => {
  it('names the input the player actually has', () => {
    expect(startHint({ touch: true, turn: false })).toMatch(/Swipe/);
    expect(startHint({ touch: false, turn: false })).toMatch(/arrow key or WASD/);
    expect(startHint({ touch: true, turn: true })).toMatch(/◀ ▶/);
    expect(startHint({ touch: false, turn: true })).toMatch(/A \/ D/);
  });
});

describe('idle screen how-to', () => {
  it('touch: swipe to start, no keyboard talk', () => {
    render(<Overlay state="idle" score={0} levelIndex={0} banner={null} touch />);
    expect(screen.getByText('Swipe or tap an arrow to start')).toBeInTheDocument();
    expect(screen.queryByText(/WASD|P to pause/)).toBeNull();
    expect(screen.getByText(/Eat food to grow/)).toBeInTheDocument();
  });

  it('keyboard: keys to start, P to pause', () => {
    render(<Overlay state="idle" score={0} levelIndex={0} banner={null} />);
    expect(screen.getByText('Press an arrow key or WASD to start')).toBeInTheDocument();
    expect(screen.getByText('P to pause')).toBeInTheDocument();
  });

  it('danger line follows the wall mode', () => {
    const { rerender } = render(<Overlay state="idle" score={0} levelIndex={0} banner={null} />);
    expect(screen.getByText(/Don’t hit walls/)).toBeInTheDocument();
    rerender(<Overlay state="idle" score={0} levelIndex={0} banner={null} wrap />);
    expect(screen.getByText(/Edges wrap/)).toBeInTheDocument();
  });

  it('game over hides the Enter / Space hint on touch', () => {
    render(<Overlay state="dead" score={10} levelIndex={0} banner={null} touch />);
    expect(screen.queryByText(/Enter \/ Space/)).toBeNull();
  });
});

describe('Add to Home Screen help', () => {
  it('points at the Share button for the browser in use', () => {
    expect(shareStep(IPHONE_CHROME)).toMatch(/address bar/);
    expect(shareStep(IPHONE_SAFARI)).toMatch(/⋯ menu/);
  });

  it('lists the steps and closes on Got it and Esc', () => {
    const onClose = vi.fn();
    render(<HomeScreenHelp onClose={onClose} userAgent={IPHONE_SAFARI} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
