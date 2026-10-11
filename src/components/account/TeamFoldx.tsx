import React, { useCallback, useEffect, useState } from "react";
import { accountApi, AccountError, type FoldxBundleInfo, type FoldxPlatform } from "../../api/accountApi";
import { SettingsBlock, SettingsSection } from "../settings/ui/Section";
import { SegmentedControl } from "../settings/ui/SegmentedControl";
import { FormAlert } from "./fields";
import { relativeTime } from "./accountUi";

/**
 * Settings → Team → "FoldX for the team" (admin, WP-F decision 6).
 *
 * The admin uploads the licensed FoldX zip once per kind of computer; every connected computer then sets
 * it up with no action from its owner. Uploading requires ticking the licence confirmation, which is
 * recorded with who and when. "Remove FoldX from the team" deletes the stored copies, and each computer
 * erases its own at its next contact; FoldX jobs then run on the shared server.
 */

const LABEL: Record<FoldxPlatform, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

export function TeamFoldx() {
  const [bundles, setBundles] = useState<FoldxBundleInfo[] | null>(null);
  const [platform, setPlatform] = useState<FoldxPlatform>("win32");
  const [file, setFile] = useState<File | null>(null);
  const [licence, setLicence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setBundles((await accountApi.listFoldxBundles()).platforms);
    } catch {
      setBundles([]);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setMessage({ tone: "danger", text: "Choose the FoldX zip first." });
    if (!licence) return setMessage({ tone: "danger", text: "Confirm the licence first." });
    setBusy(true);
    setMessage(null);
    try {
      const { bundle } = await accountApi.uploadFoldxBundle(platform, file);
      setMessage({ tone: "success", text: `FoldX for ${LABEL[platform]} is shared${bundle.expiry ? `; this build works until ${bundle.expiry}` : ""}. Connected computers set it up by themselves.` });
      setFile(null);
      setLicence(false);
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof AccountError ? err.message : "The upload failed. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm("Remove FoldX from the team? Every computer erases its copy at its next check-in, and FoldX jobs run on the shared server.")) return;
    try {
      await accountApi.revokeFoldxBundles();
      setMessage({ tone: "success", text: "FoldX was removed from the team. Computers erase their copies at their next check-in." });
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof AccountError ? err.message : "Could not remove it. Try again." });
    }
  };

  return (
    <SettingsSection title="FoldX for the team" hint="Shared with team members' own computers, for research use under your FoldX licence.">
      {message && (
        <SettingsBlock>
          <FormAlert tone={message.tone}>{message.text}</FormAlert>
        </SettingsBlock>
      )}
      <SettingsBlock title="Shared now">
        {bundles === null ? (
          <p className="acct-note">Loading…</p>
        ) : bundles.length === 0 ? (
          <p className="acct-note">Not shared. Team members' computers run pocket detection only, unless someone adds FoldX on their own computer; FoldX jobs run on the shared server.</p>
        ) : (
          <ul className="acct-agents">
            {bundles.map((b) => (
              <li key={b.platform} className="acct-agent" data-tone="ready">
                <div className="min-w-0 flex-1">
                  <div className="acct-agent-head">
                    <span className="acct-agent-name">{LABEL[b.platform]}</span>
                    <span className="acct-agent-state">{b.binaryName}</span>
                  </div>
                  <p className="acct-note">
                    Uploaded by {b.uploadedByName ?? "an admin"} {relativeTime(b.uploadedAt)}, licence confirmed then.
                    {b.expiry ? ` This build stops working on ${b.expiry}.` : " Its name carries no expiry date."}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {bundles && bundles.length > 0 && (
          <div className="acct-actions acct-actions--start">
            <button type="button" className="cs-btn-ghost" onClick={() => void revoke()}>
              Remove FoldX from the team
            </button>
          </div>
        )}
      </SettingsBlock>
      <SettingsBlock title="Share a FoldX zip">
        <form className="acct-foldx" onSubmit={upload} noValidate>
          <SegmentedControl<FoldxPlatform>
            ariaLabel="Kind of computer this FoldX is for"
            value={platform}
            onChange={setPlatform}
            options={[
              { value: "win32", label: "Windows" },
              { value: "darwin", label: "macOS" },
              { value: "linux", label: "Linux" },
            ]}
          />
          <div className="acct-foldx-row">
            <label className="sr-only" htmlFor="acct-foldx-file">
              FoldX zip
            </label>
            <input id="acct-foldx-file" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <label className="acct-foldx-row">
            <input type="checkbox" checked={licence} onChange={(e) => setLicence(e.target.checked)} />
            <span>I confirm our FoldX licence permits sharing it with our team for research use.</span>
          </label>
          <p className="acct-note">Use the zip exactly as downloaded from foldxsuite.crg.eu. It is checked before it is shared: the right program for that kind of computer, its parameter files, and its expiry date.</p>
          <div className="acct-actions acct-actions--start">
            <button type="submit" className="cs-btn-primary" disabled={busy || !file || !licence}>
              {busy ? "Uploading…" : "Share with the team"}
            </button>
          </div>
        </form>
      </SettingsBlock>
    </SettingsSection>
  );
}
