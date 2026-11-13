import { useEffect, useId, useState } from 'react';
import type { ArchWindow } from './architectureLayout';

/**
 * Numeric alternative to brushing, usable with a keyboard or on a touch screen. One phrase with the
 * fields inside it ("Zoom to residues 1 to 711"): a lone "Amino-acid positions" label at the far edge
 * of the row read as a heading over nothing.
 */
export function FunctionWindowControl({ window: win, length, onApply }: { window: ArchWindow; length: number; onApply: (win: ArchWindow) => void }) {
  const id = useId();
  const [start, setStart] = useState(String(win.start));
  const [end, setEnd] = useState(String(win.end));
  useEffect(() => { setStart(String(win.start)); setEnd(String(win.end)); }, [win.start, win.end]);
  const a = Number(start), b = Number(end);
  const valid = start !== '' && end !== '' && Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= length && a < b;
  const errorId = `${id}-error`;
  const field = (which: 'From' | 'To', value: string, set: (v: string) => void) => (
    <input id={`${id}-${which}`} aria-label={`${which} residue`} aria-invalid={!valid} aria-describedby={!valid ? errorId : undefined}
      inputMode="numeric" type="number" min={1} max={length} value={value} onChange={e => set(e.target.value)} />
  );
  return <form className="mol-window" aria-label="Protein map window" onSubmit={e => { e.preventDefault(); if (valid) onApply({ start: a, end: b }); }}>
    <span aria-hidden="true">Zoom to residues</span>
    {field('From', start, setStart)}
    <span aria-hidden="true">to</span>
    {field('To', end, setEnd)}
    <button className="viz-action" type="submit" disabled={!valid}>Zoom</button>
    {!valid && <span role="status" id={errorId} className="mol-window__error">Choose increasing positions between 1 and {length}.</span>}
  </form>;
}
