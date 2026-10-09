// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { WorkspaceTabs } from '../WorkspaceTabs';

afterEach(cleanup);
const tabs = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] as const;
function Harness() {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
  return <WorkspaceTabs id="t" label="Tabs" tabs={tabs} value={value} onChange={setValue} />;
}

it('moves selection and focus with arrow, Home and End keys, with one tab stop', () => {
  const ui = render(<Harness />);
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
