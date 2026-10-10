import { useEffect, useId, useState } from 'react';
import type { ArchWindow } from './architectureLayout';

/** Numeric alternative to brushing, usable with a keyboard or on a touch screen. */
export function FunctionWindowControl({ window: win, length, onApply }: { window: ArchWindow; length: number; onApply: (win: ArchWindow) => void }) {
  const id = useId();
  const [start, setStart] = useState(String(win.start));
  const [end, setEnd] = useState(String(win.end));
  useEffect(() => { setStart(String(win.start)); setEnd(String(win.end)); }, [win.start, win.end]);
  const a = Number(start), b = Number(end);
  const valid = start !== '' && end !== '' && Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= length && a < b;
  return <form className="mol-window" aria-label="Protein map window" onSubmit={e => { e.preventDefault(); if (valid) onApply({ start: a, end: b }); }}>
    <span>Amino-acid positions</span>
    <label htmlFor={`${id}-start`}>From <input id={`${id}-start`} aria-invalid={!valid} inputMode="numeric" type="number" min={1} max={length} value={start} onChange={e => setStart(e.target.value)} /></label>
    <label htmlFor={`${id}-end`}>To <input id={`${id}-end`} aria-invalid={!valid} inputMode="numeric" type="number" min={1} max={length} value={end} onChange={e => setEnd(e.target.value)} /></label>
    <button className="viz-action" type="submit" disabled={!valid}>Apply window</button>
    {!valid && <span role="status">Choose increasing positions between 1 and {length}.</span>}
  </form>;
}
