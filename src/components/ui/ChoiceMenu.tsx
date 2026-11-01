import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface ChoiceOption { value: string; label: string; detail?: string }

/**
 * A themed single-choice menu that replaces the browser's own `<select>` where the choices carry a
 * second line of meaning (here: inheritance and disease ID). The field names its action in words
 * ("Change", "3 available") instead of drawing an arrow.
 *
 * Keyboard follows the ARIA "select-only combobox" pattern: focus stays on the field and
 * `aria-activedescendant` names the highlighted option. The list is drawn in `document.body` so a
 * card with `overflow: hidden` cannot clip it.
 */
export function ChoiceMenu({ id, label, value, options, hint, onChange }: {
  id: string; label: string; value: string; options: ChoiceOption[]; hint: string; onChange: (value: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const field = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const selectedIndex = Math.max(0, options.findIndex(o => o.value === value));
  const current = options[selectedIndex];

  const openMenu = () => {
    const rect = field.current!.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16;
    const flip = below < 220 && rect.top > below;
    setPlace(flip
      ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(352, rect.top - 16) }
      : { left: rect.left, width: rect.width, top: rect.bottom + 6, maxHeight: Math.min(352, below) });
    setActive(selectedIndex);
    setOpen(true);
  };
  const choose = (index: number) => { onChange(options[index].value); setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!field.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    // A scroll elsewhere would leave the list floating away from its field, so it closes instead.
    const away = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', away, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  useEffect(() => { if (open) (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' }); }, [open, active]);

  const onKeyDown = (e: KeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === 'Tab') { setOpen(false); return; }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    const move: Record<string, number> = { ArrowDown: Math.min(active + 1, last), ArrowUp: Math.max(active - 1, 0), Home: 0, End: last };
    if (e.key in move) { e.preventDefault(); setActive(move[e.key]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing the first letters of a name jumps to it, as the browser's own list does.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? '' : typed.current.text) + e.key.toLowerCase(), at: now };
      const hit = options.findIndex(o => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  return <div className="cm">
    <button ref={field} id={id} type="button" className="cm__field" role="combobox" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${active}` : undefined} aria-describedby={`${id}-value`}
      onClick={() => (open ? setOpen(false) : openMenu())} onKeyDown={onKeyDown}
      onKeyUp={e => { if (e.key === ' ') e.preventDefault(); }}>
      <span className="cm__value" id={`${id}-value`} data-empty={!value || undefined}>
        <span className="cm__title">{current.label}</span>
        {current.detail && <span className="cm__detail">{current.detail}</span>}
      </span>
      <span className="cm__hint" aria-hidden="true">{open ? 'Close' : hint}</span>
    </button>
    {open && createPortal(
      <ul ref={list} id={listId} className="cm__list" role="listbox" aria-label={label} style={place}>
        {options.map((o, i) => <li key={o.value} id={`${listId}-${i}`} role="option" className="cm__option" aria-selected={o.value === value}
          data-active={i === active || undefined} data-none={!o.value || undefined}
          onMouseDown={e => e.preventDefault()} onPointerMove={() => { if (i !== active) setActive(i); }} onClick={() => choose(i)}>
          <span className="cm__title">{o.label}</span>
          {o.detail && <span className="cm__detail">{o.detail}</span>}
        </li>)}
      </ul>, document.body)}
  </div>;
}
