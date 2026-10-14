// @vitest-environment jsdom
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidebarShortcut } from '../useSidebarShortcut';

afterEach(() => document.querySelectorAll('dialog,input').forEach(el => el.remove()));
describe('sidebar shortcut', () => {
  it('yields to an open dialog and resumes after dismissal', () => {
    const toggle = vi.fn();
    renderHook(() => useSidebarShortcut(toggle));
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', ''); document.body.append(dialog);
    fireEvent.keyDown(dialog, { key: 'b', ctrlKey: true });
    expect(toggle).not.toHaveBeenCalled();
    dialog.remove();
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(toggle).toHaveBeenCalledOnce();
  });
  it('does not intercept editing, modified shortcuts or already handled events', () => {
    const toggle = vi.fn();
    const { unmount } = renderHook(() => useSidebarShortcut(toggle));
    const input = document.createElement('input'); document.body.append(input);
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true });
    const prevented = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true });
    prevented.preventDefault(); window.dispatchEvent(prevented);
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'B', metaKey: true });
    expect(toggle).toHaveBeenCalledOnce();
    unmount(); fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(toggle).toHaveBeenCalledOnce();
  });
});
