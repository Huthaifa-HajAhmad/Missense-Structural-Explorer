/**
 * AccountCard — the one frame every account screen uses: the brand lockup, a serif title, a short
 * lede and the form. It renders either as a full page (link flows, and sign-in when the workspace
 * requires it) or as a dialog over the app (an optional sign-in).
 *
 * The dialog is a real modal: focus moves in, Tab stays inside, Escape closes, and focus returns to
 * whatever opened it.
 */
import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { BrandMark } from "../ui/BrandMark";
import { useSettings } from "../../context/SettingsContext";

interface AccountCardProps {
  title: string;
  lede?: React.ReactNode;
  children: React.ReactNode;
  /** Quiet line under the card (help, legal, a way back). */
  footer?: React.ReactNode;
  variant: "page" | "dialog";
  onClose?: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Lockup() {
  return (
    <div className="acct-brand">
      <span className="acct-mark" aria-hidden>
        <BrandMark size={36} />
      </span>
      <span className="acct-wordmark">
        Missense <span className="text-cs-text-accent">&amp; Fold</span>
      </span>
    </div>
  );
}

export function AccountCard({ title, lede, children, footer, variant, onClose }: AccountCardProps) {
  const { isDark } = useSettings();
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  // Read through a ref: the effect below must run once per dialog, not whenever the parent re-renders
  // with a new callback — a re-run would refocus the first field and lose the real opener.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Dialog: move focus in, trap Tab, close on Escape, give focus back on unmount.
  useEffect(() => {
    if (variant !== "dialog") return;
    const opener = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const first = card?.querySelector<HTMLElement>("input, button[type=submit]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      // Captured on window and stopped here, so a surface underneath (the Settings drawer listens for
      // Escape and Tab on window) never acts while this dialog is on top. A sign-in that cannot be
      // dismissed must not close the drawer behind it or pull focus out of the dialog.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (!card) return;
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [variant]);

  // Page: the first field takes focus so the reader can type at once.
  useEffect(() => {
    if (variant === "page") cardRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [variant]);

  const body = (
    <div
      ref={cardRef}
      className="acct-card"
      role={variant === "dialog" ? "dialog" : undefined}
      aria-modal={variant === "dialog" ? true : undefined}
      aria-labelledby={titleId}
    >
      {variant === "dialog" && onClose && (
        <button type="button" className="acct-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
      <Lockup />
      <h1 id={titleId} className="acct-title">
        {title}
      </h1>
      {lede && <div className="acct-lede">{lede}</div>}
      {children}
    </div>
  );

  if (variant === "dialog") {
    return (
      <div className={`acct-overlay${isDark ? " dark" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className="acct-dialog-wrap">
          {body}
          {footer && <div className="acct-footer">{footer}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`acct-page${isDark ? " dark" : ""}`}>
      <main className="acct-page-inner">
        {body}
        {footer && <div className="acct-footer">{footer}</div>}
      </main>
    </div>
  );
}
