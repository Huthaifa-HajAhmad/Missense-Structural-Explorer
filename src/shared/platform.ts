/**
 * platform.ts — One answer to "which modifier does this machine use?"
 *
 * The command palette's hint chip (header) and its footer legend (palette) both name a
 * keyboard shortcut. When each spelled out its own user-agent test, the two could disagree
 * about what the app's own hotkey was called — so the test lives here once.
 *
 * BOUNDARY CONTRACT: this module is imported by `src/` and must stay pure — no imports
 * outside of `src/shared/` (enforced by scripts/check-boundaries.ts).
 */

/** True on macOS / iOS, where the palette's modifier is ⌘ rather than Ctrl. */
export function isApplePlatform(userAgent?: string): boolean {
  const agent =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "");
  return /Mac|iPhone|iPad|iPod/.test(agent);
}

/**
 * How to print the palette's hotkey for the current machine: `"⌘K"` on Apple platforms,
 * `"Ctrl K"` everywhere else. Pass a user-agent string in tests; omit it in the app.
 */
export function commandPaletteHint(userAgent?: string): string {
  return isApplePlatform(userAgent) ? "⌘K" : "Ctrl K";
}
