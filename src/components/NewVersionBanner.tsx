import { useState } from "react";

interface NewVersionBannerProps {
  stale: boolean;
  onReload: () => void;
}

/**
 * Shown when the server has been updated since this page loaded. It never reloads by itself, so an
 * analysis in progress is not lost; the reader chooses when.
 */
export function NewVersionBanner({ stale, onReload }: NewVersionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (!stale || dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-cs-border-subtle bg-cs-surface-2 px-4 py-2.5 text-sm text-cs-text-secondary shadow-lg"
    >
      <span>A new version of Missense &amp; Fold is available. Reload to update.</span>
      <button type="button" onClick={onReload} className="rounded-lg bg-[var(--cs-accent-clay)] px-3 py-1 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] focus-visible:ring-offset-1">
        Reload
      </button>
      <button type="button" onClick={() => setDismissed(true)} className="text-xs text-cs-text-muted underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] focus-visible:ring-offset-1">
        Not now
      </button>
    </div>
  );
}
