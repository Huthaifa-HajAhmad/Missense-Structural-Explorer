import React, { useEffect, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { useOptionalAccount } from "../../../context/AccountContext";
import { useSettings } from "../../../context/SettingsContext";
import { accountApi, AccountError, type PlacementPref } from "../../../api/accountApi";
import { passwordProblem } from "../../../shared/accountPolicy";
import { SettingsBlock, SettingsRow, SettingsSection } from "../ui/Section";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Switch } from "../ui/Switch";
import { Avatar } from "../../account/AccountMenu";
import { relativeTime } from "../../account/accountUi";
import { FormAlert, PasswordChecklist, PasswordField } from "../../account/fields";

const PLACEMENT_COPY: Record<PlacementPref, string> = {
  auto: "Each job runs wherever it should finish first.",
  my_machine: "Your own computer takes your jobs whenever it is connected and about as fast.",
  server_only: "Your jobs always run on the shared server, even when your computer is connected.",
};

function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  return (
    <span className="acct-save-state" aria-live="polite" data-state={state}>
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : ""}
    </span>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(next) ?? (next !== confirm ? "The two new passwords do not match." : null);
    if (!current) return setError("Enter your current password.");
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await accountApi.changePassword(current, next);
      reset();
      setOpen(false);
      setDone(true);
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Could not change the password. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <SettingsRow
        label="Password"
        description={done ? "Password changed. Every other browser was signed out." : "Changing it signs you out on every other browser."}
      >
        <button
          type="button"
          className="cs-btn-ghost"
          onClick={() => {
            setDone(false);
            setOpen(true);
          }}
        >
          Change password
        </button>
      </SettingsRow>
    );
  }

  return (
    <SettingsBlock title="Password">
      <form className="acct-form acct-form--inline" onSubmit={submit} noValidate>
        {error && <FormAlert tone="danger">{error}</FormAlert>}
        <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        <PasswordField label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <PasswordChecklist password={next} confirm={confirm} />
        <div className="acct-actions">
          <button
            type="button"
            className="cs-btn-ghost"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </button>
          <button type="submit" className="cs-btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save new password"}
          </button>
        </div>
      </form>
    </SettingsBlock>
  );
}

export function AccountSection() {
  const account = useOptionalAccount();
  const { setIsSettingsOpen } = useSettings();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  if (!account?.user) {
    return (
      <div className="space-y-7">
        <SettingsSection title="Account">
          <SettingsBlock>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-[13px] text-cs-text-secondary max-w-[48ch]">
                Sign in to keep your preferences, see your own jobs, and let the team share results.
              </p>
              <button type="button" className="cs-btn-primary" onClick={() => {
                  // Close the drawer first: one modal at a time, so focus has one place to be.
                  setIsSettingsOpen(false);
                  account?.openSignIn("requested");
                }}>
                <LogIn className="w-4 h-4" aria-hidden />
                Sign in
              </button>
            </div>
          </SettingsBlock>
        </SettingsSection>
      </div>
    );
  }

  const { user } = account;

  // Optimistic: the control moves at once; a refusal puts it back and says why.
  const save = async (patch: { placementPref?: PlacementPref; shareResults?: boolean }) => {
    // Roll back ONLY the fields this save touched, merged into the latest state, so a second quick
    // change to the other control is not undone when this one fails.
    const undo: { placementPref?: PlacementPref; shareResults?: boolean } = {};
    if (patch.placementPref !== undefined) undo.placementPref = user.placementPref;
    if (patch.shareResults !== undefined) undo.shareResults = user.shareResults;
    account.patchUser(patch);
    setSaveState("saving");
    setSaveError(null);
    window.clearTimeout(savedTimer.current);
    try {
      await accountApi.updatePreferences(patch);
      setSaveState("saved");
      savedTimer.current = window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      account.patchUser(undo);
      setSaveState("error");
      setSaveError(err instanceof AccountError ? err.message : "Could not save. Try again.");
    }
  };

  return (
    <div className="space-y-7">
      <SettingsSection title="Profile">
        <SettingsBlock title="Profile">
          <div className="acct-profile">
            <Avatar user={user} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="acct-profile-name">{user.displayName}</span>
                <span className={user.role === "admin" ? "acct-role-badge" : "acct-role-badge acct-role-badge--member"}>
                  {user.role === "admin" ? "Admin" : "Member"}
                </span>
              </div>
              <div className="acct-profile-email">{user.email}</div>
              <div className="acct-profile-meta">
                Member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                {user.lastLoginAt ? ` · signed in ${relativeTime(user.lastLoginAt)}` : ""}
              </div>
            </div>
          </div>
        </SettingsBlock>
      </SettingsSection>

      <SettingsSection
        title="Compute"
        hint="Applies to the FoldX and P2Rank jobs you start."
        action={<SaveState state={saveState} />}
      >
        {saveError && (
          <SettingsBlock>
            <FormAlert tone="danger">{saveError}</FormAlert>
          </SettingsBlock>
        )}
        <SettingsRow label="Where your jobs run" description={PLACEMENT_COPY[user.placementPref]} stacked>
          <SegmentedControl<PlacementPref>
            ariaLabel="Where your jobs run"
            value={user.placementPref}
            onChange={(placementPref) => void save({ placementPref })}
            fullWidth
            options={[
              { value: "auto", label: "Automatic" },
              { value: "my_machine", label: "Prefer my computer" },
              { value: "server_only", label: "Shared server only" },
            ]}
          />
          <p className="acct-note">Connecting your own computer arrives with the desktop agent. Until then, every job runs on the shared server.</p>
        </SettingsRow>
        <Switch
          label="Share my results with the team"
          description="Results computed on your own computer are added to the shared cache, so a teammate asking the same question gets the answer at once. Results from the shared server are always shared."
          checked={user.shareResults}
          onChange={(shareResults) => void save({ shareResults })}
        />
      </SettingsSection>

      <SettingsSection title="Security">
        <ChangePassword />
        <SettingsRow label="Sign out" description="Ends your session in this browser.">
          <button
            type="button"
            className="cs-btn-ghost"
            onClick={async () => {
              const mode = account.mode;
              await account.signOut();
              if (mode === "accounts") window.location.assign("/");
            }}
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden />
            Sign out
          </button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
