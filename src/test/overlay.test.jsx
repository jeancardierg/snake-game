/**
 * Component tests for the level identity surfaces.
 *
 * The three.js canvas cannot render under jsdom, so these tests cover the DOM
 * chrome that actually shows the player which level they are on: the Overlay
 * (idle / paused / dead / level-up banner), the Scoreboard badge, and the
 * LevelBar's next-level hint.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Overlay } from '../components/Overlay';
import { Scoreboard } from '../components/Scoreboard';
import { LevelBar } from '../components/LevelBar';
import { getLevel } from '../levels';

describe('Overlay level identifier', () => {
  it('shows the starting level title on the idle screen', () => {
    render(<Overlay state="idle" score={0} levelIndex={0} banner={null} />);
    expect(screen.getByText('SNAKE')).toBeInTheDocument();
    expect(screen.getByText(getLevel(0).title)).toBeInTheDocument();
  });

  it('shows the current level title while paused', () => {
    render(<Overlay state="paused" score={40} levelIndex={3} banner={null} />);
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(screen.getByText(getLevel(3).title)).toBeInTheDocument();
  });

  it('shows the level reached on the game over screen', () => {
    render(<Overlay state="dead" score={730} levelIndex={7} banner={null} />);
    expect(screen.getByText('GAME OVER')).toBeInTheDocument();
    expect(screen.getByText('730')).toBeInTheDocument();
    expect(screen.getByText(getLevel(7).title)).toBeInTheDocument();
  });

  it('tints the identifier with the level accent color', () => {
    const { container } = render(<Overlay state="idle" score={0} levelIndex={5} banner={null} />);
    const id = container.querySelector('.overlay-level-id');
    expect(id).toHaveStyle({ color: getLevel(5).color });
  });

  it('renders a title for deep levels past the first theme cycle', () => {
    const deep = getLevel(23);
    render(<Overlay state="dead" score={9999} levelIndex={23} banner={null} />);
    expect(screen.getByText(deep.title)).toBeInTheDocument();
    expect(deep.title).toMatch(/LEVEL 24 · \w+ III/);
  });
});

describe('Overlay during play', () => {
  it('renders nothing while running with no banner', () => {
    const { container } = render(<Overlay state="running" score={10} levelIndex={1} banner={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the banner while running — never the blocking panel', () => {
    const { container } = render(
      <Overlay state="running" score={10} levelIndex={1} banner={getLevel(1)} />
    );
    expect(container.querySelector('.overlay')).toBeNull();
    expect(container.querySelector('.overlay-banner')).not.toBeNull();
    expect(screen.getByText('LEVEL UP')).toBeInTheDocument();
    expect(screen.getByText(getLevel(1).title)).toBeInTheDocument();
  });

  it('keeps the banner click-through so it cannot block play', () => {
    const { container } = render(
      <Overlay state="running" score={10} levelIndex={2} banner={getLevel(2)} />
    );
    // The rule lives in index.css, which jsdom does not load; assert the class
    // contract instead — .overlay-banner is what carries pointer-events: none.
    expect(container.firstChild).toHaveClass('overlay-banner');
  });
});

describe('Scoreboard badge', () => {
  it('shows the short level id, with the full title as a tooltip', () => {
    const { container } = render(
      <Scoreboard score={0} best={0} levelIndex={6} state="idle" onPause={vi.fn()} />
    );
    const badge = container.querySelector('.level-badge');
    expect(badge).toHaveTextContent(getLevel(6).id);
    expect(badge).toHaveAttribute('title', getLevel(6).title);
  });

  it('stays within its box for a three-digit level', () => {
    const { container } = render(
      <Scoreboard score={0} best={0} levelIndex={120} state="idle" onPause={vi.fn()} />
    );
    expect(container.querySelector('.level-badge').textContent).toBe('L121');
  });
});

describe('LevelBar', () => {
  it('always points at a next level — progression never ends', () => {
    for (const idx of [0, 4, 40, 250]) {
      const { container, unmount } = render(<LevelBar score={0} levelIndex={idx} />);
      expect(container.querySelector('.level-bar-next')).toHaveTextContent(getLevel(idx + 1).id);
      expect(screen.queryByText('MAX LEVEL')).toBeNull();
      unmount();
    }
  });

  it('reports progress within the current level as a percentage', () => {
    const prev = getLevel(0).scoreNext;          // level 1 starts here
    const next = getLevel(1).scoreNext;
    const mid  = prev + (next - prev) / 2;
    const { container } = render(<LevelBar score={mid} levelIndex={1} />);
    expect(container.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '50');
  });

  it('clamps progress to 0 when the score is below the level floor', () => {
    const { container } = render(<LevelBar score={0} levelIndex={3} />);
    expect(container.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');
  });
});
