/**
 * AccountGate — decides, before the app mounts, whether the reader sees the app or an account screen.
 *
 *   loading            → a quiet splash (only after a beat, so a fast answer never flashes)
 *   invite/reset link  → that screen, full page
 *   /setup             → first-admin setup, full page
 *   accounts mode, signed out, app never shown → sign-in, full page
 *   otherwise          → the app, with the sign-in dialog over it when asked for
 *
 * Once the app has been on screen it is never unmounted for a lapsed session: that would throw away
 * the reader's work. A session that ends mid-use in `accounts` mode gets a sign-in dialog that cannot
 * be dismissed, over the app it protects.
 */
import React, { useEffect, useState } from "react";
import { useAccount } from "../../context/AccountContext";
import { useSettings } from "../../context/SettingsContext";
import { BrandMark } from "../ui/BrandMark";
import { InviteScreen, ResetScreen, SetupScreen, SignInScreen } from "./AccountScreens";

function Splash() {
  const { isDark } = useSettings();
  return (
    <div className={`acct-page acct-splash${isDark ? " dark" : ""}`} role="status" aria-label="Loading the workspace">
      <span className="acct-mark acct-splash-mark" aria-hidden>
        <BrandMark size={40} />
      </span>
    </div>
  );
}

export function AccountGate({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const { openSettingsTab } = useSettings();
  // State, not a ref written during render: a render React discards must not count as "shown".
  const [appShown, setAppShown] = useState(false);

  const { flow, gate, status, welcome, clearWelcome } = account;
  const showApp = status !== "loading" && (!gate || (appShown && flow === null));
  useEffect(() => {
    if (showApp && !appShown) setAppShown(true);
  }, [showApp, appShown]);

  // The first admin's next step is inviting the team: take them straight to it, once.
  useEffect(() => {
    if (!showApp || !welcome) return;
    if (welcome === "setup") openSettingsTab("team");
    clearWelcome();
  }, [showApp, welcome, clearWelcome, openSettingsTab]);

  if (status === "loading") return <Splash />;

  if (flow?.kind === "invite") {
    return <InviteScreen token={flow.token} onSignedIn={(u) => account.completeSignIn(u, { welcome: "invite" })} onLeave={account.leaveFlow} />;
  }
  if (flow?.kind === "reset") {
    return <ResetScreen token={flow.token} onSignedIn={(u) => account.completeSignIn(u, { welcome: "reset" })} onLeave={account.leaveFlow} />;
  }
  if (flow?.kind === "setup") {
    return (
      <SetupScreen
        available={Boolean(account.session?.setupAvailable)}
        onSignedIn={(u) => account.completeSignIn(u, { welcome: "setup" })}
        onLeave={account.leaveFlow}
      />
    );
  }

  if (!showApp) {
    return <SignInScreen variant="page" reason={account.signInReason ?? "required"} onSignedIn={(u) => account.completeSignIn(u)} />;
  }

  // In `accounts` mode a signed-out reader cannot work, so the dialog has no way to dismiss it.
  const mustSignIn = gate;
  const reason = account.signInReason ?? (mustSignIn ? "expired" : null);

  return (
    <>
      {children}
      {reason && (
        <SignInScreen
          variant="dialog"
          reason={reason}
          onSignedIn={(u) => account.completeSignIn(u)}
          onClose={mustSignIn ? undefined : account.closeSignIn}
        />
      )}
    </>
  );
}
