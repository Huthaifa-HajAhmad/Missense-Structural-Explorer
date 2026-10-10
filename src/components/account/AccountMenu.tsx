/**
 * AccountMenu — the header's account control.
 *
 * Signed out (and the workspace uses accounts): a "Sign in" button. Signed in: the reader's initials,
 * opening a small menu with who they are, their settings, Team for admins, and Sign out.
 *
 * The menu follows the WAI-ARIA menu-button pattern: arrow keys move, Home/End jump, Escape closes and
 * returns focus to the button, Tab and outside clicks dismiss it.
 *
 * It renders as a native popover, so the browser keeps it in the top layer — no portal, no stacking
 * context to escape, and no script reads the button's rectangle to place it. CSS anchor positioning
 * (`@supports (position-area: …)` in account.css) pins it under the trigger and flips it at the edge.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { LogIn, LogOut, UserRound, Users } from "lucide-react";
import { useOptionalAccount, type useAccount } from "../../context/AccountContext";
import { useSettings } from "../../context/SettingsContext";
import type { AccountUser } from "../../api/accountApi";

/**
 * The Popover API (Chrome 114, Firefox 125, Safari 17). Detected once. Where it is missing — an
 * older browser, or jsdom — the menu renders in the normal flow with the in-flow fallback styles,
 * so the control still works instead of being hidden by the `[popover]` user-agent style.
 */
const SUPPORTS_POPOVER =
  typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";

export function initialsOf(user: Pick<AccountUser, "displayName" | "email">): string {
  const words = user.displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return user.email.slice(0, 2).toUpperCase();
}

export function Avatar({ user, size = 28 }: { user: Pick<AccountUser, "displayName" | "email">; size?: number }) {
  return (
    <span className="acct-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden>
      {initialsOf(user)}
    </span>
  );
}

/**
 * HeaderBar renders standalone (no providers) by design, so this outer shell reads only the optional
 * account context and renders nothing without it. The menu itself, which needs Settings, mounts only
 * inside the app, where `AccountProvider` always sits within `SettingsProvider`.
 */
export function AccountMenu() {
  const account = useOptionalAccount();
  if (!account || !account.accountsEnabled) return null;
  return <AccountMenuInner account={account} />;
}

function AccountMenuInner({ account }: { account: ReturnType<typeof useAccount> }) {
  const { openSettingsTab, isDark } = useSettings();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    const menu = menuRef.current;
    // Leave the top layer before the node unmounts, so the popover's own state stays consistent.
    if (menu && typeof menu.hidePopover === "function" && menu.matches(":popover-open")) menu.hidePopover();
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => setOpen(true), []);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;

    // A light-dismiss (outside click, Escape, scroll) closes the popover without React knowing;
    // mirror it back into state so the next open toggles from the truth.
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed") setOpen(false);
    };
    menu.addEventListener("toggle", onToggle);

    // showPopover() is the enhancement: it drops the menu into the top layer, where CSS anchors it
    // under the trigger and flips it at the viewport edge. Where the API is missing the menu still
    // renders and behaves — it simply cannot anchor itself.
    if (typeof menu.showPopover === "function" && !menu.matches(":popover-open")) {
      try { menu.showPopover(); } catch { /* unsupported or already in the top layer */ }
    }

    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    // Without the Popover API there is no light-dismiss, so keep the outside-click fallback.
    if (typeof menu.showPopover !== "function") {
      const onDown = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => {
        menu.removeEventListener("toggle", onToggle);
        document.removeEventListener("mousedown", onDown);
      };
    }

    return () => menu.removeEventListener("toggle", onToggle);
  }, [open, close]);

  const { user } = account;

  if (!user) {
    return (
      <button type="button" className="acct-signin-btn" onClick={() => account.openSignIn("requested")}>
        <LogIn className="w-3.5 h-3.5" aria-hidden />
        Sign in
      </button>
    );
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      // The menu lives in a portal at the end of <body>; letting Tab run on would jump focus to the
      // top of the page. Close and return to the button, the next stop the reader expects.
      e.preventDefault();
      close(true);
    }
  };

  const go = (tab: "account" | "team") => {
    // Focus the button first: the drawer records the focused element as its opener, and the menu item
    // that had focus is about to be removed — closing Settings would otherwise strand focus on <body>.
    close(true);
    openSettingsTab(tab);
  };

  const signOut = async () => {
    close(false);
    const mode = account.mode;
    await account.signOut();
    // When the workspace requires accounts, a clean reload leaves nothing of the previous reader's
    // session on screen — this may be a shared lab computer.
    if (mode === "accounts") window.location.assign("/");
  };

  return (
    <div className="acct-menu-anchor">
      <button
        ref={buttonRef}
        type="button"
        className="acct-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${user.displayName}`}
        title={`${user.displayName} · ${user.email}`}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar user={user} />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          {...(SUPPORTS_POPOVER ? { popover: "auto" as const } : {})}
          className={`acct-menu${isDark ? " dark" : ""}`}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
        >
          <div className="acct-menu-head">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <div className="acct-menu-name">{user.displayName}</div>
              <div className="acct-menu-email">{user.email}</div>
            </div>
            {user.role === "admin" && <span className="acct-role-badge">Admin</span>}
          </div>
          <div className="acct-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="acct-menu-item" onClick={() => go("account")}>
            <UserRound className="w-4 h-4" aria-hidden />
            Account &amp; preferences
          </button>
          {user.role === "admin" && (
            <button type="button" role="menuitem" className="acct-menu-item" onClick={() => go("team")}>
              <Users className="w-4 h-4" aria-hidden />
              Team
            </button>
          )}
          <div className="acct-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="acct-menu-item" onClick={signOut}>
            <LogOut className="w-4 h-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
