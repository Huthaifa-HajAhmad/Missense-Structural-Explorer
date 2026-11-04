// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { WorkspaceTabs } from '../WorkspaceTabs';

afterEach(cleanup);
const tabs = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] as const;
function Harness({ variant }: { variant?: 'secondary' } = {}) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
  return <WorkspaceTabs variant={variant} id="t" label="Tabs" tabs={tabs} value={value} onChange={setValue} />;
}

it('marks a tab with a dot and a description, and keeps the tab name unchanged', () => {
  const ui = render(<WorkspaceTabs id="t" label="Tabs" tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B', mark: 'Holds a record' }]} value="a" onChange={() => {}} />);
  const marked = ui.getByRole('tab', { name: 'B' });
  expect(marked).toHaveAccessibleDescription('Holds a record');
  expect(marked).toHaveAttribute('data-marked');
  expect(marked).toHaveAttribute('title', 'Holds a record');
  expect(marked.querySelector('.workspace-tabs__mark')).not.toBeNull();
  expect(ui.getByRole('tab', { name: 'A' })).not.toHaveAttribute('data-marked');
  expect(ui.getByRole('tab', { name: 'A' }).querySelector('.workspace-tabs__mark')).toBeNull();
  expect(ui.getByRole('tab', { name: 'A' }).hasAttribute('aria-describedby')).toBe(false);
});

it('shows no dot on the open tab, and brings it back when another tab is opened', () => {
  const marked = [{ id: 'a', label: 'A', mark: 'Holds record A' }, { id: 'b', label: 'B', mark: 'Holds record B' }] as const;
  function Open() {
    const [value, setValue] = useState<'a' | 'b'>('a');
    return <WorkspaceTabs id="t" label="Tabs" tabs={marked} value={value} onChange={setValue} />;
  }
  const ui = render(<Open />);
  expect(ui.getByRole('tab', { name: 'A' }).querySelector('.workspace-tabs__mark')).toBeNull();
  expect(ui.getByRole('tab', { name: 'B' }).querySelector('.workspace-tabs__mark')).not.toBeNull();
  fireEvent.click(ui.getByRole('tab', { name: 'B' }));
  expect(ui.getByRole('tab', { name: 'B' }).querySelector('.workspace-tabs__mark')).toBeNull();
  expect(ui.getByRole('tab', { name: 'A' }).querySelector('.workspace-tabs__mark')).not.toBeNull();
  expect(ui.getByRole('tab', { name: 'A' })).toHaveAccessibleDescription('Holds record A');
});

it.each([undefined, 'secondary'] as const)('moves selection and focus in %s tabs with one tab stop', variant => {
  const ui = render(<Harness variant={variant} />);
  if (variant) expect(ui.getByRole('tablist')).toHaveAttribute('data-variant', 'secondary');
  else expect(ui.getByRole('tablist')).not.toHaveAttribute('data-variant');
  const list = ui.getByRole('tablist');
  fireEvent.keyDown(list, { key: 'ArrowLeft' });
  expect(ui.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(ui.getByRole('tab', { name: 'C' }));
  fireEvent.keyDown(list, { key: 'Home' });
  expect(ui.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(list, { key: 'End' });
  expect(ui.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true');
  expect(ui.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toHaveLength(1);
  expect(ui.getByRole('tab', { name: 'A' }).hasAttribute('aria-controls')).toBe(false);
});
