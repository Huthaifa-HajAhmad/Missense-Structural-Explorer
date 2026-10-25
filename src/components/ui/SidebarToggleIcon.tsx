import React from "react";

/**
 * The sidebar toggle glyph: a rounded square with a solid left panel and an open right panel.
 * Drawn as one filled even-odd shape (outer tile minus the open panel), so it stays crisp at 16px
 * and takes its colour from `currentColor` like the Lucide icons beside it.
 */
export function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4ZM10 5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H10Z"
      />
    </svg>
  );
}

export default SidebarToggleIcon;
