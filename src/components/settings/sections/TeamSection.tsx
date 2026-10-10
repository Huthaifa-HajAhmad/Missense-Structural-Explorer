import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2, RotateCw, UserPlus } from "lucide-react";
import { useOptionalAccount } from "../../../context/AccountContext";
import { accountApi, AccountError, type AccountUser, type PendingInvite, type Role } from "../../../api/accountApi";
import { SettingsBlock, SettingsSection } from "../ui/Section";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Avatar } from "../../account/AccountMenu";
import { OneTimeLink, relativeTime } from "../../account/accountUi";
import { FormAlert } from "../../account/fields";
import { isValidEmail } from "../../../shared/accountPolicy";

function messageOf(err: unknown, fallback: string): string {
  return err instanceof AccountError ? err.message : fallback;
}

// ── Invite ──────────────────────────────────────────────────────────────────────────────────────────

function InviteForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number; email: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!isValidEmail(clean)) return setError("Enter a valid email address.");
    setBusy(true);
    setError(null);
    try {
      const { inviteUrl, expiresAt } = await accountApi.createInvite(clean, role);
      setLink({ url: inviteUrl, expiresAt, email: clean });
      setEmail("");
      setRole("member");
      onCreated();
    } catch (err) {
      setError(messageOf(err, "Could not create the invite. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsBlock title="Invite someone">
      <form className="acct-invite" onSubmit={submit} noValidate>
        <div className="acct-invite-row">
          <label className="sr-only" htmlFor="acct-invite-email">
            Email address
          </label>
          <input
            id="acct-invite-email"
            className="cs-input acct-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="name@lab.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <SegmentedControl<Role>
            ariaLabel="Role"
            value={role}
            onChange={setRole}
            options={[
              { value: "member", label: "Member" },
              { value: "admin", label: "Admin" },
            ]}
          />
          <button type="submit" className="cs-btn-primary acct-invite-submit" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <UserPlus className="w-4 h-4" aria-hidden />}
            Create invite link
          </button>
        </div>
        {role === "admin" && <p className="acct-note">Admins can invite people, reset passwords and disable accounts.</p>}
        {error && <FormAlert tone="danger">{error}</FormAlert>}
      </form>
      {link && (
        <div className="mt-3">
          <p className="acct-note mb-2">
            For <strong>{link.email}</strong>
          </p>
          <OneTimeLink url={link.url} expiresAt={link.expiresAt} purpose="invite" />
        </div>
      )}
    </SettingsBlock>
  );
}

// ── Pending invites ─────────────────────────────────────────────────────────────────────────────────

function PendingInviteRow({ invite, onWithdrawn }: { invite: PendingInvite; onWithdrawn: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async () => {
    setBusy(true);
    try {
      await accountApi.withdrawInvite(invite.id);
      onWithdrawn();
    } catch (err) {
      setError(messageOf(err, "Could not withdraw the invite."));
      setBusy(false);
    }
  };

  return (
    <div className="settings-row acct-person">
      <span className="acct-avatar acct-avatar--pending" aria-hidden>
        @
      </span>
      <div className="min-w-0 flex-1">
        <div className="acct-person-name">{invite.email}</div>
        <div className="acct-person-meta">
          Invited as {invite.role} · link expires {relativeTime(invite.expiresAt)}
        </div>
        {error && <div className="acct-field-error">{error}</div>}
      </div>
      {confirming ? (
        <div className="acct-actions">
          <button type="button" className="cs-btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Keep
          </button>
          <button type="button" className="cs-btn-ghost acct-danger" onClick={withdraw} disabled={busy}>
            {busy ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      ) : (
        <button type="button" className="cs-btn-ghost" onClick={() => setConfirming(true)}>
          Withdraw
        </button>
      )}
    </div>
  );
}

// ── People ──────────────────────────────────────────────────────────────────────────────────────────

function PersonRow({ person, isSelf, onChanged }: { person: AccountUser; isSelf: boolean; onChanged: (u?: AccountUser) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const panelId = `acct-person-${person.id}`;
  const disabled = person.status === "disabled";

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(messageOf(err, "That did not work. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const setRole = (role: Role) =>
    run("role", async () => {
      const { user } = await accountApi.updateUser(person.id, { role });
      onChanged(user);
    });

  const setStatus = (status: "active" | "disabled") =>
    run("status", async () => {
      const { user } = await accountApi.updateUser(person.id, { status });
      setConfirmDisable(false);
      setResetLink(null);
      onChanged(user);
    });

  return (
    <div className="settings-row acct-person-wrap" data-open={open}>
      <button
        type="button"
        className="acct-person acct-person--button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={disabled ? "acct-avatar-dim" : undefined}>
          <Avatar user={person} size={32} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="acct-person-name">
            {person.displayName}
            {isSelf && <span className="acct-you"> (you)</span>}
          </span>
          <span className="acct-person-meta">
            {person.email} · {person.lastLoginAt ? `signed in ${relativeTime(person.lastLoginAt)}` : "has not signed in yet"}
          </span>
        </span>
        {disabled && <span className="acct-status-badge">Disabled</span>}
        <span className={person.role === "admin" ? "acct-role-badge" : "acct-role-badge acct-role-badge--member"}>
          {person.role === "admin" ? "Admin" : "Member"}
        </span>
        <ChevronDown className="acct-chevron w-4 h-4" aria-hidden />
      </button>

      {open && (
        <div id={panelId} className="acct-person-panel">
          {error && <FormAlert tone="danger">{error}</FormAlert>}
          {notice && <FormAlert tone="success">{notice}</FormAlert>}

          <div className="acct-panel-row">
            <div>
              <div className="acct-panel-label">Role</div>
              <div className="acct-panel-hint">Admins manage the team from this page.</div>
            </div>
            <SegmentedControl<Role>
              ariaLabel={`Role for ${person.displayName}`}
              value={person.role}
              onChange={(r) => r !== person.role && void setRole(r)}
              options={[
                { value: "member", label: "Member" },
                { value: "admin", label: "Admin" },
              ]}
            />
          </div>

          {!disabled && (
            <div className="acct-panel-row">
              <div>
                <div className="acct-panel-label">Password</div>
                <div className="acct-panel-hint">A one-time link lets them choose a new password. It works once and expires in 24 hours.</div>
              </div>
              <button
                type="button"
                className="cs-btn-ghost"
                disabled={busy !== null}
                onClick={() =>
                  run("reset", async () => {
                    const { resetUrl, expiresAt } = await accountApi.createResetLink(person.id);
                    setResetLink({ url: resetUrl, expiresAt });
                  })
                }
              >
                {busy === "reset" ? "Creating…" : resetLink ? "Create a new link" : "Create reset link"}
              </button>
            </div>
          )}
          {resetLink && <OneTimeLink url={resetLink.url} expiresAt={resetLink.expiresAt} purpose="reset" />}

          {!disabled && !isSelf && (
            <div className="acct-panel-row">
              <div>
                <div className="acct-panel-label">Sessions</div>
                <div className="acct-panel-hint">Signs them out on every browser, for example after a lost laptop.</div>
              </div>
              <button
                type="button"
                className="cs-btn-ghost"
                disabled={busy !== null}
                onClick={() =>
                  run("signout", async () => {
                    await accountApi.signOutEverywhere(person.id);
                    setNotice(`${person.displayName} was signed out everywhere.`);
                  })
                }
              >
                {busy === "signout" ? "Signing out…" : "Sign out everywhere"}
              </button>
            </div>
          )}

          {!isSelf && (
            <div className="acct-panel-row">
              <div>
                <div className="acct-panel-label">{disabled ? "Account disabled" : "Access"}</div>
                <div className="acct-panel-hint">
                  {disabled
                    ? "They cannot sign in. Enabling lets them sign in again with their old password."
                    : "Disabling signs them out at once and stops them signing in. Nothing they made is deleted."}
                </div>
              </div>
              {disabled ? (
                <button type="button" className="cs-btn-ghost" disabled={busy !== null} onClick={() => void setStatus("active")}>
                  {busy === "status" ? "Enabling…" : "Enable account"}
                </button>
              ) : confirmDisable ? (
                <div className="acct-actions">
                  <button type="button" className="cs-btn-ghost" onClick={() => setConfirmDisable(false)} disabled={busy !== null}>
                    Cancel
                  </button>
                  <button type="button" className="cs-btn-ghost acct-danger" onClick={() => void setStatus("disabled")} disabled={busy !== null}>
                    {busy === "status" ? "Disabling…" : `Disable ${person.displayName.split(" ")[0]}`}
                  </button>
                </div>
              ) : (
                <button type="button" className="cs-btn-ghost acct-danger" onClick={() => setConfirmDisable(true)}>
                  Disable account
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────────────────────────────

export function TeamSection() {
  const account = useOptionalAccount();
  const [users, setUsers] = useState<AccountUser[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isAdmin = account?.user?.role === "admin";

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [u, i] = await Promise.all([accountApi.listUsers(), accountApi.listInvites()]);
      setUsers(u.users);
      setInvites(i.invites);
    } catch (err) {
      setLoadError(messageOf(err, "Could not load the team."));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <SettingsSection title="Team">
        <SettingsBlock>
          <p className="text-[13px] text-cs-text-secondary">Only workspace admins can manage the team.</p>
        </SettingsBlock>
      </SettingsSection>
    );
  }

  const selfId = account?.user?.id;
  const active = users?.filter((u) => u.status === "active").length ?? 0;

  return (
    <div className="space-y-7">
      <SettingsSection
        title="Invite someone"
        hint="There is no email service: copy the link and send it yourself. Each link works once and expires in three days."
      >
        <InviteForm onCreated={() => void load()} />
      </SettingsSection>

      {invites.length > 0 && (
        <SettingsSection title={`Waiting to join · ${invites.length}`}>
          {invites.map((invite) => (
            <PendingInviteRow key={invite.id} invite={invite} onWithdrawn={() => setInvites((list) => list.filter((i) => i.id !== invite.id))} />
          ))}
        </SettingsSection>
      )}

      <SettingsSection
        title={users ? `People · ${active} active` : "People"}
        action={
          <button type="button" className="acct-icon-btn" onClick={() => void load()} aria-label="Refresh the team list" title="Refresh">
            <RotateCw className="w-3.5 h-3.5" aria-hidden />
          </button>
        }
      >
        {loadError && (
          <SettingsBlock>
            <FormAlert tone="danger">
              {loadError}{" "}
              <button type="button" className="acct-link" onClick={() => void load()}>
                Try again
              </button>
            </FormAlert>
          </SettingsBlock>
        )}
        {!users && !loadError &&
          [0, 1, 2].map((i) => (
            <div key={i} className="settings-row acct-person" aria-hidden>
              <span className="acct-skeleton acct-skeleton--avatar" />
              <span className="flex-1 space-y-1.5">
                <span className="acct-skeleton block w-40 h-3" />
                <span className="acct-skeleton block w-64 h-2.5" />
              </span>
            </div>
          ))}
        {users?.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            isSelf={person.id === selfId}
            onChanged={(updated) => {
              if (updated) setUsers((list) => list?.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)) ?? null);
              if (updated && updated.id === selfId) account?.setUser({ ...account.user!, ...updated });
            }}
          />
        ))}
      </SettingsSection>
    </div>
  );
}
