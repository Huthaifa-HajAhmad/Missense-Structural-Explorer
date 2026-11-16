/**
 * Trigger a browser download for a string or Blob payload, deferring object URL
 * revocation so the browser does not tear down the blob URL before starting the fetch.
 */
export function downloadBlob(
  filename: string,
  mime: string,
  content: string | Blob,
  revokeDelayMs = 1000
): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  if (a.style) a.style.display = "none";
  if (typeof Node !== "undefined" && a instanceof Node && document.body) {
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
}
