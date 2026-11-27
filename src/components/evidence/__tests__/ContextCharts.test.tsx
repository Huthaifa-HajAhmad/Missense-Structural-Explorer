// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PextStrip } from '../ContextCharts';
import type { PextRegion } from '../../../shared/pext';

const region = (i: number, length: number): PextRegion => {
  const start = i * 1000 + 1;
  return { start, stop: start + length - 1, mean: 0.5, tissues: [] };
};
const drawnNumbers = (container: HTMLElement) => [...container.querySelectorAll('[data-region-label]')]
  .map(label => Number(label.getAttribute('data-region-label')));

describe('PextStrip region numbers', () => {
  it('names how many region numbers it leaves off the map, so none vanish silently', () => {
    // Alternating wide and narrow regions crowd the numbers, so some cannot be drawn.
    const regions = Array.from({ length: 60 }, (_, i) => region(i, i % 2 ? 40 : 600));
    const { container } = render(<PextStrip regions={regions} activeIndex={0} position={null} />);
    const missing = regions.length - drawnNumbers(container).length;
    expect(missing).toBeGreaterThan(0);
    expect(screen.getByText(`+${missing} more region numbers not drawn on the map.`)).toBeInTheDocument();
  });

  it('draws every number, and adds no note, when the regions have room', () => {
    const regions = Array.from({ length: 5 }, (_, i) => region(i, 400));
    const { container } = render(<PextStrip regions={regions} activeIndex={2} position={null} />);
    expect(drawnNumbers(container)).toEqual([1, 2, 3, 4, 5]);
    expect(screen.queryByText(/more region numbers not drawn/)).not.toBeInTheDocument();
  });
});
