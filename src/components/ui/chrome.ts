/**
 * Shared class strings for app chrome (header + sidebar).
 *
 * The header's icon buttons, the sidebar's collapse toggle and the palette trigger were each
 * styled inline with slightly different padding, radius, icon size and press behaviour — so the
 * two halves of the frame read as different products. One definition keeps them one family.
 */

/** 32px square icon button: muted → primary on hover, subtle fill, clay focus ring. */
export const CHROME_ICON_BUTTON =
  "relative inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-[var(--cs-radius-input)] " +
  "text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle aria-pressed:text-cs-text-primary " +
  "transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]";

/** Hairline vertical divider used between chrome groups. */
export const CHROME_DIVIDER = "w-px h-5 bg-cs-border-subtle shrink-0";
