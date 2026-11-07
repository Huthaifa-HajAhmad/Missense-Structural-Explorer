import { useEffect, useId, useRef, useState } from "react";
import { Camera, ChevronDown, ClipboardCopy, Download } from "lucide-react";
import { useDismiss } from "./useDismiss";

export interface StructureImageMenuProps {
  onDownload: () => Promise<void>;
  /** Resolves true when the image reached the clipboard. */
  onCopy: () => Promise<boolean>;
}

/** The "Image" menu: save or copy a picture of the canvas. It owns its open state and the copy result. */
export function StructureImageMenu({ onDownload, onCopy }: StructureImageMenuProps) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useDismiss(open, setOpen, wrapRef, triggerRef);

  // The button label shows the copy result for a moment, then goes back to "Image".
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  // Closing by choosing an item puts keyboard focus back on the button, as Escape does.
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const download = () => {
    close();
    void onDownload();
  };
  const copy = async () => {
    close();
    setCopyState((await onCopy()) ? "copied" : "failed");
  };

  return (
    <div className="s3d-menu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef} type="button" className="s3d-btn"
        aria-expanded={open} aria-controls={menuId} aria-label="Save or copy an image of the view"
        onClick={() => setOpen(!open)}
      >
        <Camera aria-hidden="true" />
        <span>{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Image"}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="s3d-menu" id={menuId} role="group" aria-label="Image actions">
          <button type="button" className="s3d-menu__item" onClick={download}>
            <Download aria-hidden="true" />Download PNG
          </button>
          <button type="button" className="s3d-menu__item" onClick={copy}>
            <ClipboardCopy aria-hidden="true" />Copy to clipboard
          </button>
          <p className="s3d-menu__note">The filename records the structure and colouring.</p>
        </div>
      )}
    </div>
  );
}
