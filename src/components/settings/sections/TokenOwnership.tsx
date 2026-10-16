import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { accountApi, AccountError, type SavedSecret } from "../../../api/accountApi";
import { getLastCredentialUse, subscribeCredentialUse } from "../../../api/authSession";
import { useOptionalAccount } from "../../../context/AccountContext";
import { credentialSourceLabel, type CredentialKind } from "../../../shared/credentials";
import { SettingsBlock } from "../ui/Section";

/**
 * Whose token pays for Biohub, Hugging Face and Tamarind calls (WP-I4).
 *
 * The plain-words explanation, the "last used" line under each token, and (for a signed-in person) saving
 * a token to their account so it follows them to other browsers (WP-I4b).
 */

export function TokenOwnershipIntro() {
  return (
    <SettingsBlock className="!py-3">
      <p className="text-[12px] leading-relaxed text-cs-text-secondary" data-testid="token-ownership-intro">
        With your own Biohub, Hugging Face and Tamarind tokens, your requests use <strong>your</strong> allowance at
        those services instead of the team's. Without one, this server may lend the team token, which everyone
        shares. When a result calls one of these services, you are told which token it ran on.
      </p>
    </SettingsBlock>
  );
}

function formatWhen(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** "Last request: ran on the team token (3 min ago)" — or nothing before the first use. */
export function LastCredentialUse({ kind }: { kind: CredentialKind }) {
  const last = useSyncExternalStore(subscribeCredentialUse, getLastCredentialUse, getLastCredentialUse)[kind];
  if (!last) return null;
  const { use, at } = last;
  const what =
    use.source === "none"
      ? use.refusal === "team-share-used"
        ? "not run: your hourly share of the team token is used"
        : use.refusal === "team-token-off"
          ? "not run: the team token is not lent on this server"
          : "not run"
      : `ran on ${credentialSourceLabel(use.source)}`;
  return (
    <p className="px-4 pb-2 -mt-1 text-[11px] text-cs-text-muted" data-testid={`last-credential-use-${kind}`}>
      Last request: {what} ({formatWhen(at)})
    </p>
  );
}

export interface SavedSecretsState {
  /** Null while unknown, or when the reader is not signed in. */
  saved: Partial<Record<CredentialKind, SavedSecret>> | null;
  /** The server can encrypt (APP_SESSION_SECRET is set). */
  available: boolean;
  /** The saved tokens could not be loaded. */
  loadFailed: boolean;
  signedIn: boolean;
  save: (kind: CredentialKind, token: string) => Promise<void>;
  remove: (kind: CredentialKind) => Promise<void>;
}

/** The signed-in person's saved tokens, loaded once for the whole section. */
export function useSavedSecrets(): SavedSecretsState {
  const account = useOptionalAccount();
  const signedIn = Boolean(account?.user);
  const [saved, setSaved] = useState<Partial<Record<CredentialKind, SavedSecret>> | null>(null);
  const [available, setAvailable] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Kinds saved or removed in this session: the initial list must not overwrite them if it arrives later. */
  const touched = useRef(new Set<CredentialKind>());

  useEffect(() => {
    if (!signedIn) {
      setSaved(null);
      return;
    }
    let cancelled = false;
    accountApi
      .savedSecrets()
      .then(({ available, secrets }) => {
        if (cancelled) return;
        setAvailable(available);
        setLoadFailed(false);
        setSaved(prev => {
          const next: Partial<Record<CredentialKind, SavedSecret>> = Object.fromEntries(secrets.map(s => [s.kind, s]));
          for (const kind of touched.current) {
            if (prev?.[kind]) next[kind] = prev[kind];
            else delete next[kind];
          }
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setSaved(prev => prev ?? {});
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const save = useCallback(async (kind: CredentialKind, token: string) => {
    const entry = await accountApi.saveSecret(kind, token);
    touched.current.add(kind);
    setSaved(prev => ({ ...(prev ?? {}), [kind]: entry }));
  }, []);
  const remove = useCallback(async (kind: CredentialKind) => {
    await accountApi.removeSecret(kind);
    touched.current.add(kind);
    setSaved(prev => {
      const next = { ...(prev ?? {}) };
      delete next[kind];
      return next;
    });
  }, []);

  return { saved, available, loadFailed, signedIn, save, remove };
}

/**
 * Under one token field: save the typed token to the account, or show and remove the saved one. A token
 * typed in this browser is used before a saved one; after saving, the field is cleared so the browser no
 * longer holds it.
 */
export function AccountTokenControls({
  kind,
  label,
  browserToken,
  clearBrowserToken,
  secrets,
}: {
  kind: CredentialKind;
  label: string;
  browserToken: string;
  clearBrowserToken: () => void;
  secrets: SavedSecretsState;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!secrets.signedIn) return null;
  const entry = secrets.saved?.[kind];
  const typed = browserToken.trim();

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(done);
    } catch (err) {
      const msg = err instanceof AccountError ? err.message : "That did not work; try again.";
      setError(msg);
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pb-3 -mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" data-testid={`account-token-${kind}`}>
      {entry ? (
        <>
          <span className={entry.readable ? "text-cs-text-secondary" : "text-amber-700 dark:text-amber-400"}>
            {entry.readable
              ? `Saved to your account${entry.hint ? ` (ends …${entry.hint})` : ""}; used from any browser you sign in on.`
              : `A saved ${label} token can no longer be read by the server; save it again.`}
          </span>
          <button
            type="button"
            className="font-medium text-cs-text-accent underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
            disabled={busy}
            aria-label={`Remove the ${label} token saved to your account`}
            onClick={() => run(() => secrets.remove(kind), `Removed the saved ${label} token.`)}
          >
            Remove
          </button>
        </>
      ) : null}
      {typed && secrets.available ? (
        <button
          type="button"
          className="font-medium text-cs-text-accent underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
          disabled={busy}
          aria-label={entry ? `Replace the saved ${label} token with the one entered here` : `Save this ${label} token to my account`}
          onClick={() =>
            run(async () => {
              await secrets.save(kind, typed);
              clearBrowserToken();
            }, `Saved to your account. This browser no longer holds it.`)
          }
        >
          {entry ? "Replace the saved token with this one" : "Save to my account"}
        </button>
      ) : null}
      {!entry && !typed && secrets.available ? (
        <span className="text-cs-text-muted">Signed in: a token entered here can be saved to your account, so it follows you.</span>
      ) : null}
      {secrets.loadFailed ? (
        <span className="text-cs-text-muted">Your saved tokens could not be loaded; reopen Settings to try again.</span>
      ) : null}
      {error && (
        <span role="alert" className="text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
      {/* Kept mounted and hidden visually so screen readers announce changes via aria-live without duplicate visual text. */}
      <span role="status" aria-live="polite" className="sr-only">
        {message ?? ""}
      </span>
    </div>
  );
}
