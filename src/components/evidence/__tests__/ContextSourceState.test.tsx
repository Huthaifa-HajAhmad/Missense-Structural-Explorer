// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextSourceState } from '../ContextSourceState';

describe('source recovery actions', () => {
  it('does not imply a failed request when a successful lookup returns no record', () => {
    render(<ContextSourceState name="ClinGen dosage" load={{ status: 'ready', data: { status: 'not-found', message: 'No matching curation.' } }} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('No result');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it.each([
    ['error', 'Try again'],
    ['not-installed', 'Check again'],
  ])('provides recovery for %s', (status, label) => {
    const retry = vi.fn();
    render(<ContextSourceState name="Source" load={{ status: 'ready', data: { status } }} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('does not retry an active read', () => {
    render(<ContextSourceState name="Source" load={{ status: 'loading', data: null }} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Running');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
