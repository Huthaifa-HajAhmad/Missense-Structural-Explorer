/**
 * accountUi.tsx — small pieces the Account and Team settings share: relative times and the
 * copy-this-link card for invite and reset links.
 */
import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

const RTF = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

/** "just now", "5 minutes ago", "in 3 days", or a date beyond a week. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  const minutes = Math.round(diff / 60_000);
  const hours = Math.round(diff / 3_600_000);
  const days = Math.round(diff / 86_400_000);
  if (!RTF) return new Date(at).toLocaleDateString();
  if (Math.abs(minutes) < 60) return RTF.format(minutes, "minute");
  if (Math.abs(hours) < 24) return RTF.format(hours, "hour");
  if (Math.abs(days) <= 7) return RTF.format(days, "day");
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

async function copyText(text: string, fallbackInput: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API refused (insecure origin, permissions): select the text so Ctrl+C works.
    fallbackInput?.select();
    return false;
  }
}

/**
 * A one-time link to hand over. There is no email service, so the admin copies it and sends it
 * themselves; the card says so, and says how long the link lives.
 */
export function OneTimeLink({ url, expiresAt, purpose }: { url: string; expiresAt: number; purpose: "invite" | "reset" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "select">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    <div className="acct-link-card">
      <div className="acct-link-card-head">
        <Link2 className="w-3.5 h-3.5" aria-hidden />
        {purpose === "invite" ? "Invite link ready" : "Reset link ready"}
      </div>
      <div className="acct-link-row">
        <input
          ref={inputRef}
          className="cs-input acct-link-input"
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          aria-label={purpose === "invite" ? "Invite link" : "Reset link"}
        />
        <button
          type="button"
          className="cs-btn-primary acct-copy"
          onClick={async () => setState((await copyText(url, inputRef.current)) ? "copied" : "select")}
        >
          {state === "copied" ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="acct-link-note" aria-live="polite">
        {state === "select"
          ? "Copying was blocked by the browser. The link is selected: press Ctrl+C (⌘C on a Mac)."
          : `Send it to them yourself. It works once and expires ${relativeTime(expiresAt)}.`}
      </p>
    </div>
  );
}
