/**
 * AccountContext — who is signed in, what the server's AUTH_MODE asks of the browser, and which
 * account flow (invite, reset, first-admin setup) a link opened.
 *
 * WHAT IT DECIDES
 * ---------------
 *   • `gate` — the app must not mount: a link flow is open, or the server runs AUTH_MODE=accounts
 *     and nobody is signed in (every write would be refused, so the app would only fail).
 *   • `accountsEnabled` — whether account chrome (the header's Sign in / avatar, the Account and Team
 *     settings) is shown at all. A server still on `legacy` with no accounts shows none of it.
 *   • `status: "unavailable"` — the server has no account routes (an older build) or could not be
 *     reached. The app then behaves exactly as before accounts existed.
 *
 * Link tokens arrive in the URL fragment (`#invite=…`, `#reset=…`). They are read once, kept in
 * memory, and removed from the address bar at once so they never linger in history or a shared link.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { accountApi, AccountError, type AccountUser, type AuthMode, type SessionInfo } from "../api/accountApi";
import { subscribeAuthLapse } from "../api/authSession";

export type AccountFlow = { kind: "invite"; token: string } | { kind: "reset"; token: string } | { kind: "setup" } | null;

/** Why the sign-in card is showing, so it can say so. */
export type SignInReason = "requested" | "required" | "expired";

interface AccountContextValue {
  status: "loading" | "ready" | "unavailable";
  mode: AuthMode;
  user: AccountUser | null;
  session: SessionInfo | null;
  flow: AccountFlow;
  accountsEnabled: boolean;
  gate: boolean;
  signInReason: SignInReason | null;
  openSignIn: (reason?: SignInReason) => void;
  closeSignIn: () => void;
  /** Any flow that ends signed in (sign-in, invite, reset, setup) lands here. */
  completeSignIn: (user: AccountUser, opts?: { welcome?: "setup" | "invite" | "reset" }) => void;
  /** Set once after a flow completes; the shell shows it once and clears it. */
  welcome: "setup" | "invite" | "reset" | null;
  clearWelcome: () => void;
  leaveFlow: () => void;
  signOut: () => Promise<void>;
  setUser: (user: AccountUser) => void;
  /** Merge fields into the signed-in user against the LATEST state (safe for overlapping saves). */
  patchUser: (patch: Partial<AccountUser>) => void;
  refresh: () => Promise<SessionInfo | null>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

/** How long start-up waits for the session before giving up and running as before accounts. */
const SESSION_TIMEOUT_MS = 4000;

function readFlowFromLocation(): AccountFlow {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const invite = params.get("invite");
  const reset = params.get("reset");
  let flow: AccountFlow = null;
  if (invite) flow = { kind: "invite", token: invite };
  else if (reset) flow = { kind: "reset", token: reset };
  else if (window.location.pathname.replace(/\/+$/, "") === "/setup") flow = { kind: "setup" };

  if (invite || reset) {
    try {
      // The token is now in memory; take it out of the address bar and history entry.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch {
      /* a sandboxed frame may refuse; the flow still works */
    }
  }
  return flow;
}

function leaveSetupPath(): void {
  if (window.location.pathname.replace(/\/+$/, "") !== "/setup") return;
  try {
    window.history.replaceState(window.history.state, "", "/" + window.location.search);
  } catch {
    /* best effort */
  }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [flow, setFlow] = useState<AccountFlow>(readFlowFromLocation);
  const [status, setStatus] = useState<AccountContextValue["status"]>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [signInReason, setSignInReason] = useState<SignInReason | null>(null);
  const [welcome, setWelcome] = useState<AccountContextValue["welcome"]>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const refresh = useCallback(async () => {
    const attempt = () =>
      Promise.race([
        accountApi.session(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), SESSION_TIMEOUT_MS)),
      ]);
    try {
      let next: SessionInfo;
      try {
        next = await attempt();
      } catch (err) {
        // An older server without account routes answers 404: that is final. A timeout or a network
        // blip gets one more try, so a slow start on an `accounts` server is not mistaken for a server
        // without accounts (which would mount the app and let every write fail).
        if (err instanceof AccountError && err.status === 404) throw err;
        next = await attempt();
      }
      setSession(next);
      setStatus("ready");
      return next;
    } catch {
      // Keep a session we already had (a blip); only a first load falls back to "unavailable".
      setStatus((s) => (s === "ready" ? s : "unavailable"));
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * A request refused after the app's own re-auth attempt. Outside `legacy`, that usually means the
   * sign-in session ended (idle timeout, admin sign-out, disabled account): re-read the session, and
   * if nobody is signed in any more, ask the reader to sign in again rather than fail silently.
   */
  useEffect(
    () =>
      subscribeAuthLapse((lapse) => {
        const current = sessionRef.current;
        if (!lapse || !current || current.mode === "legacy") return;
        void refresh().then((next) => {
          if (next && !next.user && current.user) setSignInReason("expired");
          else if (next && !next.user) setSignInReason("required");
        });
      }),
    [refresh],
  );

  const completeSignIn = useCallback<AccountContextValue["completeSignIn"]>((user, opts) => {
    setSession((s) => (s ? { ...s, user, accountsExist: true, setupAvailable: false } : s));
    setSignInReason(null);
    setFlow(null);
    leaveSetupPath();
    if (opts?.welcome) setWelcome(opts.welcome);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await accountApi.signOut();
    } finally {
      setSession((s) => (s ? { ...s, user: null } : s));
      setSignInReason(null);
    }
  }, []);

  const value = useMemo<AccountContextValue>(() => {
    const mode = session?.mode ?? "legacy";
    const user = session?.user ?? null;
    const ready = status === "ready";
    return {
      status,
      mode,
      user,
      session,
      flow,
      accountsEnabled: ready && (mode !== "legacy" || Boolean(session?.accountsExist) || Boolean(user)),
      gate: flow !== null || (ready && mode === "accounts" && !user),
      signInReason,
      openSignIn: (reason = "requested") => setSignInReason(reason),
      closeSignIn: () => setSignInReason(null),
      completeSignIn,
      welcome,
      clearWelcome: () => setWelcome(null),
      leaveFlow: () => {
        setFlow(null);
        leaveSetupPath();
      },
      signOut,
      setUser: (next) => setSession((s) => (s ? { ...s, user: next } : s)),
      patchUser: (patch) => setSession((s) => (s?.user ? { ...s, user: { ...s.user, ...patch } } : s)),
      refresh,
    };
  }, [status, session, flow, signInReason, welcome, completeSignIn, signOut, refresh]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}

/** For chrome that may render in isolation (tests, previews): null outside the provider. */
export function useOptionalAccount(): AccountContextValue | null {
  return useContext(AccountContext);
}
