import { useEffect } from 'react';

/** Shell shortcuts yield while a native modal owns keyboard interaction. */
export function useSidebarShortcut(toggleSidebar: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'b') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);
}
