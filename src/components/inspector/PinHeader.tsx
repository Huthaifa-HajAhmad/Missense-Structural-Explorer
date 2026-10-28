import { Pin, X } from 'lucide-react';

/** The one release control for a pinned reading: a bare glyph at the head of the card, where the eyebrow
 * that says something is pinned already sits. Every Evidence rail shares it, so Clear pin is never
 * a different control (or at the foot of the card, below the reading's source link) from tab to tab. */
export function ClearPinButton({ onClear, label = 'Clear pin' }: { onClear: () => void; label?: string }) {
  return <button type="button" className="pin-clear" aria-label={label} title={label} onClick={onClear}><X size={15} aria-hidden="true" /></button>;
}

export function PinHeader({ eyebrow, onClear }: { eyebrow: string; onClear?: () => void }) {
  return <header className="pin-head">
    <span className="eyebrow"><Pin size={13} aria-hidden="true" />{eyebrow}</span>
    {onClear && <ClearPinButton onClear={onClear} />}
  </header>;
}
