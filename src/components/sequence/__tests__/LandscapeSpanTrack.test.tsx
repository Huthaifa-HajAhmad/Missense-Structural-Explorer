// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandscapeSpanTrack } from "../LandscapeSpanTrack";
import { LandscapeDomainTracks } from "../LandscapeDomainTracks";

describe("annotation layout", () => {
  it("keeps the full UniProt name visible outside a narrow span", () => {
    render(<LandscapeDomainTracks domains={[{ kind: 'domain', name: 'Ig-like C2-type 1', start: 10, end: 10 }]}
      start={1} end={100} width={100} onPick={() => {}} />);
    const button = screen.getByRole('button', { name: /^Ig-like C2-type 1/ });
    expect(button.querySelector('.ls-span-track__label')?.textContent).toBe('Ig-like C2-type 1');
  });

  it("preserves one-residue geometry while widening the button and placing nearby labels in separate rows", () => {
    const pick = vi.fn();
    render(<LandscapeSpanTrack start={1} end={100} width={100} onPick={pick} annotationLabels spans={[
      { start: 10, end: 10, label: 'First annotation', detail: 'First full annotation' },
      { start: 11, end: 11, label: 'Second annotation', detail: 'Second full annotation' },
      { start: 50, end: 60, label: 'Wide annotation', detail: 'Eleven residues' }
    ]} />);
    const first = screen.getByRole('button', { name: 'First full annotation' });
    const second = screen.getByRole('button', { name: 'Second full annotation' });
    expect(first.style.inlineSize).toBe('24px');
    expect((first.querySelector('.ls-span-track__visual') as HTMLElement).style.inlineSize).toBe('1px');
    expect(second.style.insetBlockStart).not.toBe(first.style.insetBlockStart);
    const wide = screen.getByRole('button', { name: 'Eleven residues' }).querySelector<HTMLElement>('.ls-span-track__visual')!;
    expect(wide.style.inlineSize).toBe('11px');
    fireEvent.click(first);
    expect(pick).toHaveBeenCalledWith(10);
  });

  it("keeps long full names without truncation and wraps the external caption inside the plot", () => {
    const name = 'A very long UniProt domain annotation that needs several lines';
    render(<LandscapeSpanTrack start={1} end={100} width={350} onPick={() => {}} annotationLabels
      spans={[{ start: 99, end: 100, label: name, detail: name }]} />);
    const caption = screen.getByRole('button', { name }).querySelector<HTMLElement>('.ls-span-track__label')!;
    expect(caption.textContent).toBe(name);
    const button = caption.closest('button')!;
    const left = parseFloat(button.style.insetInlineStart) + parseFloat(caption.style.insetInlineStart);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + parseFloat(caption.style.inlineSize)).toBeLessThanOrEqual(350);
  });
});
