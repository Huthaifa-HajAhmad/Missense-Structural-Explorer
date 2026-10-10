/**
 * AccountScreens — sign in, accept an invite, choose a new password, and create the first admin.
 *
 * Written for people who are not developers: every state says what happened and what to do next, in
 * one sentence, and none of them is a dead end. There is no email service, so "forgot your password"
 * and "link expired" both point to the workspace admin, by name of the role.
 */
import React, { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { accountApi, AccountError, type AccountUser } from "../../api/accountApi";
import { PASSWORD_MIN_LENGTH, isValidEmail, passwordProblem } from "../../shared/accountPolicy";
import type { SignInReason } from "../../context/AccountContext";
import { AccountCard } from "./AccountCard";
import { FormAlert, PasswordChecklist, PasswordField, SubmitButton, TextField, formatCountdown, useCountdown } from "./fields";

const ASK_ADMIN = "Ask your workspace admin for a new link.";

function messageOf(err: unknown): string {
  return err instanceof AccountError ? err.message : "Something went wrong. Try again.";
}

// ── Sign in ─────────────────────────────────────────────────────────────────────────────────────────

const SIGN_IN_LEDE: Record<SignInReason, string> = {
  requested: "Use the email address your workspace admin invited.",
  required: "This workspace asks everyone to sign in before running analyses.",
  expired: "Your session ended. Sign in again to carry on where you left off.",
};

export function SignInScreen({
  variant,
  reason,
  onSignedIn,
  onClose,
}: {
  variant: "page" | "dialog";
  reason: SignInReason;
  onSignedIn: (user: AccountUser) => void;
  onClose?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lockSeconds = useCountdown(lockedUntil);
  const locked = lockSeconds > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || locked) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await accountApi.signIn(email.trim(), password);
      onSignedIn(user);
    } catch (err) {
      if (err instanceof AccountError && err.status === 429 && err.retryAfterSec) {
        setLockedUntil(Date.now() + err.retryAfterSec * 1000);
        setError(null);
      } else {
        setError(messageOf(err));
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountCard
      variant={variant}
      onClose={onClose}
      title={reason === "expired" ? "Sign in again" : "Sign in"}
      lede={SIGN_IN_LEDE[reason]}
      footer={
        <p>
          Forgot your password? Your workspace admin can send you a reset link.
          {variant === "dialog" && onClose && reason === "requested" && (
            <>
              {" "}
              <button type="button" className="acct-link" onClick={onClose}>
                Continue without signing in
              </button>
            </>
          )}
        </p>
      }
    >
      <form className="acct-form" onSubmit={submit} noValidate>
        {locked && (
          <FormAlert tone="danger">
            Too many attempts. You can try again in <strong className="tabular-nums">{formatCountdown(lockSeconds)}</strong>, or ask your
            workspace admin for a reset link.
          </FormAlert>
        )}
        {error && !locked && <FormAlert tone="danger">{error}</FormAlert>}
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <SubmitButton busy={busy} busyLabel="Signing in…" disabled={locked}>
          Sign in
          <ArrowRight className="w-4 h-4" aria-hidden />
        </SubmitButton>
      </form>
    </AccountCard>
  );
}

// ── New password (shared by invite, reset and setup) ────────────────────────────────────────────────

function NewPasswordFields({
  password,
  confirm,
  setPassword,
  setConfirm,
  showErrors,
}: {
  password: string;
  confirm: string;
  setPassword: (v: string) => void;
  setConfirm: (v: string) => void;
  showErrors: boolean;
}) {
  const problem = passwordProblem(password);
  return (
    <>
      <PasswordField
        label="Password"
        name="new-password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={`A passphrase of a few words is easier to remember than ${PASSWORD_MIN_LENGTH} random characters.`}
        error={showErrors ? problem : null}
        required
      />
      <PasswordField
        label="Confirm password"
        name="confirm-password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={showErrors && !problem && confirm !== password ? "The two passwords do not match." : null}
        required
      />
      <PasswordChecklist password={password} confirm={confirm} />
    </>
  );
}

function newPasswordReady(password: string, confirm: string): boolean {
  return passwordProblem(password) === null && password === confirm;
}

// ── Accept an invite ────────────────────────────────────────────────────────────────────────────────

export function InviteScreen({ token, onSignedIn, onLeave }: { token: string; onSignedIn: (user: AccountUser) => void; onLeave: () => void }) {
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [loadError, setLoadError] = useState<{ invalid: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    accountApi
      .inviteInfo(token)
      .then((info) => live && setInvite(info))
      .catch((err) => live && setLoadError({ invalid: err instanceof AccountError && err.status === 404, message: messageOf(err) }));
    return () => {
      live = false;
    };
  }, [token, attempt]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (!name.trim() || !newPasswordReady(password, confirm) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await accountApi.acceptInvite(token, name.trim(), password);
      onSignedIn(user);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError?.invalid) {
    return (
      <AccountCard variant="page" title="This invite link no longer works">
        <FormAlert tone="info">Invite links work once and expire after three days. {ASK_ADMIN}</FormAlert>
        <button type="button" className="cs-btn-ghost acct-secondary" onClick={onLeave}>
          Go to the workspace
        </button>
      </AccountCard>
    );
  }

  if (loadError) {
    return (
      <AccountCard variant="page" title="Could not open your invite">
        <FormAlert tone="danger">{loadError.message}</FormAlert>
        <button type="button" className="cs-btn-primary acct-submit" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </AccountCard>
    );
  }

  if (!invite) {
    return (
      <AccountCard variant="page" title="Opening your invite…">
        <div className="acct-loading" role="status">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
          <span className="sr-only">Checking the invite link</span>
        </div>
      </AccountCard>
    );
  }

  return (
    <AccountCard
      variant="page"
      title="Join the workspace"
      lede={
        <>
          You were invited as <strong>{invite.email}</strong>
          {invite.role === "admin" ? ", with admin rights" : ""}. Choose your name and a password to finish.
        </>
      }
      footer={<p>Your password is stored only as a one-way hash. Nobody, including the admin, can read it.</p>}
    >
      <form className="acct-form" onSubmit={submit} noValidate>
        {error && <FormAlert tone="danger">{error}</FormAlert>}
        {/* Lets password managers save the login under the right address. */}
        <input type="email" name="username" autoComplete="username" value={invite.email} readOnly hidden />
        <TextField
          label="Your name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint="Shown to your team beside the jobs you run."
          error={showErrors && !name.trim() ? "Enter your name." : null}
          maxLength={80}
          required
        />
        <NewPasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} showErrors={showErrors} />
        <SubmitButton busy={busy} busyLabel="Creating your account…">
          Create account
          <ArrowRight className="w-4 h-4" aria-hidden />
        </SubmitButton>
      </form>
    </AccountCard>
  );
}

// ── Reset a password ────────────────────────────────────────────────────────────────────────────────

export function ResetScreen({ token, onSignedIn, onLeave }: { token: string; onSignedIn: (user: AccountUser) => void; onLeave: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dead, setDead] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (!newPasswordReady(password, confirm) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await accountApi.resetPassword(token, password);
      onSignedIn(user);
    } catch (err) {
      if (err instanceof AccountError && err.code === "RESET_INVALID") setDead(true);
      else setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (dead) {
    return (
      <AccountCard variant="page" title="This reset link no longer works">
        <FormAlert tone="info">Reset links work once and expire after 24 hours. {ASK_ADMIN}</FormAlert>
        <button type="button" className="cs-btn-ghost acct-secondary" onClick={onLeave}>
          Go to the workspace
        </button>
      </AccountCard>
    );
  }

  return (
    <AccountCard
      variant="page"
      title="Choose a new password"
      lede="Once it is saved you will be signed in here, and signed out on every other browser."
    >
      <form className="acct-form" onSubmit={submit} noValidate>
        {error && <FormAlert tone="danger">{error}</FormAlert>}
        <NewPasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} showErrors={showErrors} />
        <SubmitButton busy={busy} busyLabel="Saving…">
          Save and sign in
        </SubmitButton>
      </form>
    </AccountCard>
  );
}

// ── First admin ─────────────────────────────────────────────────────────────────────────────────────

export function SetupScreen({ available, onSignedIn, onLeave }: { available: boolean; onSignedIn: (user: AccountUser) => void; onLeave: () => void }) {
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lockSeconds = useCountdown(lockedUntil);

  if (!available) {
    return (
      <AccountCard variant="page" title="Setup is already complete">
        <FormAlert tone="info">
          This workspace already has an admin, so the setup page is closed for good. Sign in with your account, or ask the admin for an
          invite.
        </FormAlert>
        <button type="button" className="cs-btn-ghost acct-secondary" onClick={onLeave}>
          Go to the workspace
        </button>
      </AccountCard>
    );
  }

  const emailValid = isValidEmail(email.trim().toLowerCase());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (busy || lockSeconds > 0 || !secret || !name.trim() || !emailValid || !newPasswordReady(password, confirm)) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await accountApi.setup({ secret, email: email.trim(), displayName: name.trim(), password });
      onSignedIn(user);
    } catch (err) {
      if (err instanceof AccountError && err.status === 429 && err.retryAfterSec) setLockedUntil(Date.now() + err.retryAfterSec * 1000);
      else setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountCard
      variant="page"
      title="Set up your workspace"
      lede="Create the first account. It will be the workspace admin, who invites everyone else. This page closes for good once it is done."
    >
      <form className="acct-form" onSubmit={submit} noValidate>
        {lockSeconds > 0 && (
          <FormAlert tone="danger">
            Too many wrong secrets. Try again in <strong className="tabular-nums">{formatCountdown(lockSeconds)}</strong>.
          </FormAlert>
        )}
        {error && lockSeconds === 0 && <FormAlert tone="danger">{error}</FormAlert>}
        <PasswordField
          label="Setup secret"
          name="setup-secret"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          hint={
            <>
              The <code className="acct-code">ADMIN_SETUP_SECRET</code> value from the server's <code className="acct-code">.env</code> file.
            </>
          }
          error={showErrors && !secret ? "Enter the setup secret." : null}
          required
        />
        <div className="acct-divider" role="separator" />
        <TextField
          label="Your name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={showErrors && !name.trim() ? "Enter your name." : null}
          maxLength={80}
          required
        />
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="You will sign in with this address."
          error={showErrors && !emailValid ? "Enter a valid email address." : null}
          required
        />
        <NewPasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} showErrors={showErrors} />
        <SubmitButton busy={busy} busyLabel="Creating the admin account…" disabled={lockSeconds > 0}>
          Create admin account
          <ArrowRight className="w-4 h-4" aria-hidden />
        </SubmitButton>
      </form>
    </AccountCard>
  );
}
