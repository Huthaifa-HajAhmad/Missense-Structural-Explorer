import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { accountApi, AccountError, type LearnedCeiling } from "../../api/accountApi";
import { SettingsBlock, SettingsSection } from "../settings/ui/Section";
import { FormAlert } from "./fields";

/**
 * Settings → Team → "Learned memory limits" (admin, WP-G2).
 *
 * When a FoldX or pocket job runs out of memory, the queue learns the size that did not fit on that kind
 * of computer (WP-D) and, with `COMPUTE_ROUTING=on`, refuses that size there instead of running it into
 * the same crash. A limit can be wrong (a misclassified failure, or the host got more memory), so the
 * admin can see them and forget them; two new out-of-memory failures teach a limit again.
 */

const TOOL: Record<LearnedCeiling["type"], string> = { foldx: "FoldX", p2rank: "Pocket detection" };

/**
 * A host class (`hostClassOf`: `<arch>-<native|emulated>-<cores>c-<GiB>g`, `agent/` in front for a member's
 * computer) in plain words: "members' computers with 8 cores and 16 GB of memory". Falls back to the raw
 * class only if it is not in that shape.
 */
export function describeHostClass(c: Pick<LearnedCeiling, "hostClass" | "onServer">): string {
  if (c.onServer) return "the shared server";
  const agent = c.hostClass.startsWith("agent/");
  const m = /^(x64|arm64)-(native|emulated)-(\d+)c-(\d+)g$/.exec(agent ? c.hostClass.slice("agent/".length) : c.hostClass);
  const who = agent ? "members' computers" : "servers";
  if (!m) return `${who} of class ${c.hostClass}`;
  return `${who} with ${m[3]} cores and ${m[4]} GB of memory${m[2] === "emulated" ? " (running FoldX under emulation)" : ""}`;
}

export function ComputeLimits() {
  const [state, setState] = useState<{ enforced: boolean; ceilings: LearnedCeiling[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setState(await accountApi.learnedCeilings());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof AccountError ? err.message : "Could not load the learned limits.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  // The button that held focus disappears with the limits it forgot: focus goes to the outcome instead.
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  const forget = async () => {
    if (!window.confirm("Forget every learned memory limit? Jobs of any size are tried again; two new out-of-memory failures teach a limit afresh.")) return;
    setBusy(true);
    try {
      const { removed } = await accountApi.forgetCeilings();
      await load();
      setMessage({ tone: "success", text: removed > 0 ? "The learned limits were forgotten." : "There was nothing to forget." });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof AccountError ? err.message : "Could not forget the limits. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Learned memory limits"
      hint="When a job runs out of memory, the server learns the structure size that did not fit there and stops sending that size to the same kind of computer."
    >
      {message && (
        <SettingsBlock>
          <div ref={messageRef} tabIndex={-1}>
            <FormAlert tone={message.tone}>{message.text}</FormAlert>
          </div>
        </SettingsBlock>
      )}
      <SettingsBlock>
        {loadError ? (
          <FormAlert tone="danger">
            {loadError}{" "}
            <button type="button" className="acct-link" onClick={() => void load()}>
              Try again
            </button>
          </FormAlert>
        ) : state === null ? (
          <p className="acct-note" aria-busy>
            <Loader2 className="w-3.5 h-3.5 animate-spin inline" aria-hidden /> Loading…
          </p>
        ) : state.ceilings.length === 0 ? (
          <p className="acct-note">None learned. No job has run out of memory recently.</p>
        ) : (
          <>
            <ul className="acct-limits">
              {state.ceilings.map((c) => (
                <li key={`${c.type}|${c.hostClass}`} className="acct-note">
                  <strong>{TOOL[c.type]}</strong> on {describeHostClass(c)}: a structure of {c.residues.toLocaleString("en-US")} residues ran out of memory, so that size and larger {state.enforced ? "are refused there" : "would be refused there"}.
                </li>
              ))}
            </ul>
            {!state.enforced && (
              <p className="acct-note">These limits are recorded but not applied yet: they take effect once compute routing is switched on (<code>COMPUTE_ROUTING=on</code>).</p>
            )}
            <div className="acct-actions acct-actions--start">
              <button type="button" className="cs-btn-ghost" onClick={() => void forget()} disabled={busy}>
                {busy ? "Forgetting…" : "Forget these limits"}
              </button>
            </div>
          </>
        )}
      </SettingsBlock>
    </SettingsSection>
  );
}
