import React, { useCallback, useEffect, useState } from "react";
import { Download, Laptop, Loader2 } from "lucide-react";
import { accountApi, AccountError, type AgentDownload } from "../../api/accountApi";
import { describeAgent, describeAgentRecent, type AgentView } from "../../shared/agentProtocol";
import { SettingsBlock, SettingsRow } from "../settings/ui/Section";
import { FormAlert, formatCountdown, useCountdown } from "./fields";
import { relativeTime } from "./accountUi";

/**
 * "Your computers" (WP-F): connect a computer of your own so your FoldX and pocket jobs can run on it.
 *
 * The person downloads the agent, starts it, and types the six-character code shown here into the page
 * the agent opens. Status comes from the server in plain words (`describeAgent`, shared with the agent's
 * own page), never a stack trace. Refreshed every few seconds while this section is open, so pairing,
 * tool setup and pausing show up without a reload.
 */

function guessPlatform(): string | null {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "win32-x64";
  if (/Mac OS X|Macintosh/i.test(ua)) return "darwin-arm64";
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux-x64";
  return null;
}

function ConnectCode({ code, expiresAt, onDone }: { code: string; expiresAt: number; onDone: () => void }) {
  const left = useCountdown(expiresAt);
  return (
    <div className="acct-pair" role="group" aria-label="Connection code">
      <p className="acct-note">On your computer, start the agent. In the page it opens, type this code:</p>
      <p className="acct-pair-code" aria-live="polite">
        {left > 0 ? code : "Expired"}
      </p>
      <p className="acct-note">
        {left > 0 ? `Works once, for ${formatCountdown(left)}.` : "This code has expired. Get a new one."}{" "}
        <button type="button" className="cs-btn-ghost" onClick={onDone}>
          Done
        </button>
      </p>
    </div>
  );
}

export function YourComputers() {
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [downloads, setDownloads] = useState<AgentDownload[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAgents((await accountApi.listMyAgents()).agents);
    } catch {
      setAgents((a) => a ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    accountApi.agentDownloads().then((d) => setDownloads(d.platforms)).catch(() => {});
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await accountApi.createPairingCode());
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Could not get a code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (agent: AgentView) => {
    if (!window.confirm(`Disconnect “${agent.name}”? Your jobs will run on the shared server until you connect it again.`)) return;
    try {
      await accountApi.disconnectAgent(agent.id);
      await load();
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Could not disconnect. Try again.");
    }
  };

  const mine = guessPlatform();
  const ordered = [...downloads].sort((a, b) => (a.platform === mine ? -1 : b.platform === mine ? 1 : 0));

  return (
    <>
      <SettingsRow
        label="Your computers"
        description="Lend a computer of your own to your FoldX and pocket jobs. Only your jobs run on it, and anything it cannot run goes to the shared server."
        stacked
      >
        {error && <FormAlert tone="danger">{error}</FormAlert>}
        {agents === null ? (
          <p className="acct-note" aria-busy>
            <Loader2 className="w-3.5 h-3.5 animate-spin inline" aria-hidden /> Loading…
          </p>
        ) : agents.length === 0 ? (
          <p className="acct-note">No computer connected yet.</p>
        ) : (
          <ul className="acct-agents">
            {agents.map((a) => {
              const s = describeAgent(a);
              return (
                <li key={a.id} className="acct-agent" data-tone={s.tone}>
                  <Laptop className="w-4 h-4 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="acct-agent-head">
                      <span className="acct-agent-name">{a.name}</span>
                      <span className="acct-agent-state">{s.label}</span>
                    </div>
                    <p className="acct-note">{s.detail}</p>
                    {!a.online && a.lastSeenAt ? <p className="acct-note">Last seen {relativeTime(a.lastSeenAt)}.</p> : null}
                    {describeAgentRecent(a.recent) ? <p className="acct-note">{describeAgentRecent(a.recent)}</p> : null}
                  </div>
                  <button type="button" className="cs-btn-ghost" onClick={() => void disconnect(a)} aria-label={`Disconnect ${a.name}`}>
                    Disconnect
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {code ? (
          <ConnectCode code={code.code} expiresAt={code.expiresAt} onDone={() => setCode(null)} />
        ) : (
          <div className="acct-actions acct-actions--start">
            <button type="button" className="cs-btn-primary" onClick={() => void connect()} disabled={busy}>
              {busy ? "Getting a code…" : "Connect my computer"}
            </button>
          </div>
        )}
      </SettingsRow>
      <SettingsBlock title="Get the agent">
        {ordered.length === 0 ? (
          <p className="acct-note">Your workspace admin has not made the agent available here yet. Ask them for the agent zip.</p>
        ) : (
          <>
            <p className="acct-note">Unzip it anywhere and double-click “Start Agent”. Nothing is installed on your computer.</p>
            <ul className="acct-downloads">
              {ordered.map((d) => (
                <li key={d.platform}>
                  <a className={d.platform === mine ? "cs-btn-primary" : "cs-btn-ghost"} href={d.url} download>
                    <Download className="w-3.5 h-3.5" aria-hidden />
                    {d.label} · {Math.round(d.sizeBytes / 1048576)} MB
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </SettingsBlock>
    </>
  );
}
