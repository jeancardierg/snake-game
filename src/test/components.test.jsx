/**
 * Render tests for the presentational components.
 *
 * These previously had 0% coverage. GameCanvas is intentionally excluded — it
 * needs a real WebGL context that jsdom does not provide; its logic is covered
 * by useSnake.test.jsx and gameLogic.test.js.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Scoreboard } from '../components/Scoreboard';
import { LevelBar } from '../components/LevelBar';
import { Overlay } from '../components/Overlay';
import { DPad } from '../components/DPad';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LEVELS, DIR } from '../constants';

afterEach(cleanup);

// ─── Scoreboard ────────────────────────────────────────────────────────────────

describe('Scoreboard', () => {
  it('renders score, best, and the level label', () => {
    render(<Scoreboard score={30} best={80} levelIndex={0} />);
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText(LEVELS[0].label)).toBeInTheDocument();
  });

  it('does not apply the flash class at score 0', () => {
    const { container } = render(<Scoreboard score={0} best={0} levelIndex={0} />);
    expect(container.querySelector('.score-flash')).toBeNull();
  });

  it('applies the flash class when score > 0', () => {
    const { container } = render(<Scoreboard score={10} best={10} levelIndex={0} />);
    expect(container.querySelector('.score-flash')).not.toBeNull();
  });

  it('clamps an out-of-range levelIndex to the last level', () => {
    render(<Scoreboard score={0} best={0} levelIndex={99} />);
    expect(screen.getByText(LEVELS[LEVELS.length - 1].label)).toBeInTheDocument();
  });
});

// ─── LevelBar ────────────────────────────────────────────────────────────────

describe('LevelBar', () => {
  it('exposes progress via aria-valuenow (0% at a level start)', () => {
    render(<LevelBar score={0} levelIndex={0} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('names the next level below the final level', () => {
    render(<LevelBar score={0} levelIndex={0} />);
    expect(screen.getByText(new RegExp(LEVELS[1].label))).toBeInTheDocument();
  });

  it('shows MAX LEVEL and full progress on the final level', () => {
    render(<LevelBar score={9999} levelIndex={LEVELS.length - 1} />);
    expect(screen.getByText('MAX LEVEL')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});

// ─── Overlay ────────────────────────────────────────────────────────────────

describe('Overlay', () => {
  it('renders nothing while running', () => {
    const { container } = render(<Overlay state="running" score={0} levelIndex={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the title when idle', () => {
    render(<Overlay state="idle" score={0} levelIndex={0} />);
    expect(screen.getByText('SNAKE')).toBeInTheDocument();
  });

  it('shows PAUSED and calls onPause from the Resume button', () => {
    const onPause = vi.fn();
    render(<Overlay state="paused" score={0} levelIndex={0} onPause={onPause} />);
    fireEvent.click(screen.getByText('Resume'));
    expect(onPause).toHaveBeenCalledOnce();
  });

  it('shows GAME OVER with the final score and calls onReset from Play Again', () => {
    const onReset = vi.fn();
    render(<Overlay state="dead" score={120} levelIndex={2} onReset={onReset} />);
    expect(screen.getByText('GAME OVER')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Play Again'));
    expect(onReset).toHaveBeenCalledOnce();
  });
});

// ─── DPad ────────────────────────────────────────────────────────────────

describe('DPad', () => {
  it('renders four labelled direction buttons', () => {
    render(<DPad onDir={() => {}} levelIndex={0} />);
    ['Move up', 'Move down', 'Move left', 'Move right'].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  it('calls onDir with the matching vector on pointer-down', () => {
    const onDir = vi.fn();
    render(<DPad onDir={onDir} levelIndex={0} />);
    fireEvent.pointerDown(screen.getByLabelText('Move up'));
    expect(onDir).toHaveBeenCalledWith(DIR.UP);
    fireEvent.pointerDown(screen.getByLabelText('Move right'));
    expect(onDir).toHaveBeenCalledWith(DIR.RIGHT);
  });

  it('clamps an out-of-range levelIndex without crashing', () => {
    expect(() => render(<DPad onDir={() => {}} levelIndex={-5} />)).not.toThrow();
  });
});

// ─── ErrorBoundary ────────────────────────────────────────────────────────────

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(<ErrorBoundary><div>alive</div></ErrorBoundary>);
    expect(screen.getByText('alive')).toBeInTheDocument();
  });

  it('renders the fallback UI when a child throws', () => {
    const Boom = () => { throw new Error('kaboom'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText('GAME CRASHED')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    spy.mockRestore();
  });
});
