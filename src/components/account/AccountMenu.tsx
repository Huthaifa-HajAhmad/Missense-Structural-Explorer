/**
 * AccountMenu — the header's account control.
 *
 * Signed out (and the workspace uses accounts): a "Sign in" button. Signed in: the reader's initials,
 * opening a small menu with who they are, their settings, Team for admins, and Sign out.
 *
 * The menu follows the WAI-ARIA menu-button pattern: arrow keys move, Home/End jump, Escape closes and
 * returns focus to the button, Tab and outside clicks dismiss it.
 *
 * It renders in a portal at the document root, positioned from the button. Inside the header it was
 * trapped in the header's stacking context, and the workspace rail painted over it.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogIn, LogOut, UserRound, Users } from "lucide-react";
import { useOptionalAccount, type useAccount } from "../../context/AccountContext";
import { useSettings } from "../../context/SettingsContext";
import type { AccountUser } from "../../api/accountApi";

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
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // Place the portal under the button before paint, so it never flashes at the wrong spot.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close(false);
    };
    // A fixed menu would drift from its button on resize; closing is the honest answer.
    const onResize = () => close(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, anchor]);

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
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar user={user} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={`acct-menu${isDark ? " dark" : ""}`}
          style={{ top: anchor.top, right: anchor.right }}
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
        </div>,
        document.body
      )}
    </div>
  );
}
