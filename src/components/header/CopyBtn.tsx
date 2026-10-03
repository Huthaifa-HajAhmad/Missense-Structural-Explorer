import React, { useCallback, useState } from "react";
import { Copy, Check } from "lucide-react";

/** Copy-to-clipboard icon button with transient checkmark feedback and timer cleanup */
export function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (!navigator?.clipboard?.writeText) {
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard access denied or rejected
      });
  }, [text]);

  return (
    <button
      type="button"
      className="vh-icon-btn"
      onClick={handleCopy}
      title={`Copy ${label}`}
      aria-label={copied ? `Copied ${label} to clipboard` : `Copy ${label}`}
    >
      {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2} />}
    </button>
  );
}
