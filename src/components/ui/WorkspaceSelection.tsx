import React, { useRef } from 'react';
import { ArrowRight, Undo2 } from 'lucide-react';

/** Navigation preserves selection; only the explicit reset changes the pinned residue. */
export function WorkspaceSelection({ position, variantPosition, destination, onNavigate, onReset }: {
  position: number | null; variantPosition: number | null; destination: string;
  onNavigate: () => void; onReset: () => void;
}) {
  const navigateRef = useRef<HTMLButtonElement>(null);
  return <div className="workspace-selection">
    <span role="status">{position ? <>Selected residue <strong>{position}</strong>{position === variantPosition && <span> · queried variant</span>}</> : 'Select a residue to inspect across views'}</span>
    <div className="workspace-selection__actions">
      {variantPosition && position !== variantPosition && <button type="button" onClick={() => { onReset(); navigateRef.current?.focus(); }}><Undo2 aria-hidden="true" />Return to variant</button>}
      <button type="button" ref={navigateRef} onClick={onNavigate}>{destination}<ArrowRight aria-hidden="true" /></button>
    </div>
  </div>;
}
