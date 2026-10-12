# Lend your computer to your own jobs

FoldX and pocket detection (P2Rank) are the two slow jobs in Missense & Fold. On the shared server FoldX
runs emulated on an ARM machine, roughly 60 times slower than on an ordinary Windows or Linux PC. You can
let your own computer run **your own** FoldX and pocket jobs instead. Nothing is installed system-wide,
nobody else's jobs ever run on it, and anything it cannot run still runs on the shared server.

This page is for team members first, then for the workspace admin, then for whoever looks after the
server. The design is `doc/COMPUTE_ROUTING_PLAN.md`, work package WP-F.

---

## For team members

### Connect a computer (once)

1. In Missense & Fold open **Settings → Account**. Under **Get the agent**, download the zip for your
   computer (the button for the kind of computer you are using is highlighted).
2. Unzip it anywhere, for example in Documents, and double-click **Start Agent** (Windows),
   **start-agent.command** (macOS) or **start-agent.sh** (Linux). A black window and a page in your
   browser open. Keep the black window open while you lend the computer.
3. Back in **Settings → Account → Your computers**, press **Connect my computer**. Type the six-character
   code it shows into the agent's page and press **Connect**. The code works once, for 10 minutes.

The first start downloads Java and P2Rank (about 350 MB, once). If your workspace shares FoldX, the agent
sets it up by itself; the page then says "FoldX is provided by your lab for research use only". If it does
not, the page asks you to drop in the FoldX zip you downloaded from <https://foldxsuite.crg.eu/>. Use the
zip exactly as downloaded; the agent finds what it needs inside and tells you plainly if the zip is the
wrong one (for example "This looks like the Linux build of FoldX; this computer needs the Windows one").

### Day to day

- **Settings → Account → Your computers** shows each computer in plain words: Connected, Paused,
  Not connected, or what is still missing.
- **Pause** on the agent's page stops lending the computer: a job it was running goes back to the shared
  server, and new jobs wait for the server. **Resume** lends it again.
- **Disconnect** (on the agent's page, or in Settings) removes the computer from your account. Its FoldX
  copy from the workspace is erased.
- Close the black window to stop the agent. A job in progress goes back to the shared server; nothing is
  lost.

### What runs where

When your workspace has switched live routing on (`COMPUTE_ROUTING=on`), each FoldX or pocket job you
start is sent to **whichever of your connected computers or the shared server should finish it first**.
FoldX usually goes to your computer, because the shared server runs FoldX under emulation and is much
slower. A second job waits behind the first on your computer only if that is still quicker than the server.
"My jobs" and the Energetics progress card say where each job runs and why ("Waiting for your computer
(Lab PC) to pick it up", "Running on your computer (Lab PC)").

If your computer does not pick a job up (it went offline, was paused, lost the tool, or has not claimed it
within two minutes), the shared server runs it instead, and the job says so. If your computer starts a job
and cannot finish it, the server runs it too. Nothing is lost either way.

Before live routing is on (the default, `shadow`), your computer still takes **your jobs that are waiting**
for the shared server: when the server is busy, your backlog runs on your computer instead of waiting.

With **Settings → Account → Where your jobs run = Shared server only**, your computer takes nothing. With
**My computer**, a near tie goes to your computer instead of the server.

**Settings → Account → Your computers** shows what each computer did in the last 30 days: how many of your
jobs it finished, and how long FoldX and pocket detection typically took on it.

A result your computer produced is checked by the server before it is used (it must be for the variant and
residue that was asked, with sensible numbers). It is shared with colleagues only if **Share my results
with the team** is on, as for results from the server.

### Something is wrong

| You see | What to do |
|---|---|
| "Not connected" in Settings | Start the agent on that computer. Your jobs run on the server meanwhile. |
| "That code is not valid" | Codes work once, for 10 minutes. Press **Connect my computer** for a new one. |
| "This computer was disconnected from the workspace" on the agent page | Someone disconnected it, or your account was disabled. Connect it again with a new code. |
| FoldX "Not set up" | Your workspace has not shared FoldX: drop the FoldX zip on the agent page. |
| FoldX "has expired" | FoldX academic builds stop working on the date in their file name. Ask your admin for the current build, or drop the new zip on the agent page. |
| Pocket detection "could not be set up" | The download failed (network, proxy). It tries again at the next start. See "Manual setup" below if it keeps failing. |

The agent keeps everything in one folder: `%LOCALAPPDATA%\MissenseAgent` on Windows, `~/.missense-agent`
elsewhere. Its activity log is `agent.log` there (it never contains your token). Deleting the folder resets
the agent completely.

### Manual setup (only if the automatic downloads are blocked)

The agent downloads two open-source tools from pinned addresses and checks each against a pinned SHA-256
(`server/agent/tools.ts`):

- Eclipse Temurin JRE 21.0.12.1+1 for your platform, from <https://adoptium.net/>, unpacked into
  `tools/jre/` in the agent's folder.
- P2Rank 2.6-alpha (`p2rank_2.6-alpha.tar.gz` from <https://github.com/rdk/p2rank/releases/tag/2.6-alpha>),
  unpacked so that `tools/p2rank/p2rank_2.6-alpha/prank` exists.

Restart the agent; it tests both and uses them.

---

## For the workspace admin

### Share FoldX with the team (optional)

**Settings → Team → FoldX for the team.** Choose the kind of computer (Windows, macOS, Linux), pick the zip
exactly as downloaded from foldxsuite.crg.eu, tick **I confirm our FoldX licence permits sharing it with our
team for research use**, and press **Share with the team**. The zip is checked before it is stored: the
program for that kind of computer (recognised by its executable header), the `molecules` folder,
`rotabase.txt`, and the build's expiry date. Your confirmation, who and when, go to the audit log
(`admin.foldx_bundle_uploaded`). Connected computers install it within a minute, with no action from their
owners. Sharing a newer build is the same upload.

**Remove FoldX from the team** deletes the stored copies. Every computer erases its copy at its next
check-in (within a minute when online; an offline computer does it before it takes any FoldX job), and FoldX
jobs run on the shared server. A FoldX that a person dropped in themselves is theirs and is not touched.

The licence position is the owner's (plan decision 6); nothing here is legal advice.

### Make the agent downloadable

The agent zips are built from this repository and placed in `data/agent-bundles/` on the server
(`AGENT_BUNDLE_DIR`), which **Settings → Account → Get the agent** lists:

```sh
npm ci
npm run build:agent
npm run build:agent-bundle -- --platform win32-x64     # also darwin-arm64, darwin-x64, linux-x64, linux-arm64
cp dist/agent-bundle/MissenseAgent-*.zip /path/to/deploy/data/agent-bundles/
```

`build:agent-bundle` downloads a portable Node.js runtime (pinned version and SHA-256) and packs it with the
agent, a one-click start file and a README. Rebuild after an agent change; a computer running an agent of a
different protocol version is told to download the current one.

### Seeing what computers do

The audit log records pairing (`agent.paired`), disconnects (`agent.revoked`), each claim
(`agent.job_claimed`), completion (`agent.job_completed`) and bundle downloads. Telemetry rows for jobs a
computer ran carry `host_id = agent:<id>` and that computer's host class, so the placement engine learns its
speed and memory separately from the server's.

---

## For whoever runs the server

- Agents call `https://<your host>/api/v1/agent/*` over the same Caddy TLS, authenticated only by their own
  token. No port, tunnel or edge exception is needed. The routes, their rules and the result checks are in
  `server/routes/agent.ts`, `server/services/infra/agent-jobs.ts` and `agent-results.ts`; the OpenAPI spec
  lists them under **Agents**.
- A paused standby (blue/green handover) answers agents with `503 STANDBY`; they retry. A job a computer
  holds under a live lease survives a server restart.
- A computer's job is leased for 60 s and renewed every 20 s (`AGENT_LEASE_SEC`, `AGENT_HEARTBEAT_SEC`). A
  lost lease, a failure, an invalid result or a disconnect hands the job to the server once
  (`placement = 'server'`), and no computer takes it again.
- Files: the team FoldX bundle in `data/tool-bundles/foldx/` (`TOOL_BUNDLES_DIR`), the agent zips in
  `data/agent-bundles/` (`AGENT_BUNDLE_DIR`). Both are under the `data/` volume, so they survive deploys.
  Include `data/tool-bundles` in off-server backups only if you want to keep the uploaded FoldX copy.
- Optional: `AGENT_ACCEPTED_FOLDX_VERSIONS` / `AGENT_ACCEPTED_P2RANK_VERSIONS` (comma-separated) refuse
  results from other tool versions. Unset, any well-formed version is accepted; the version is always part
  of the cache key, so two versions never answer for each other.
- The Redis queue backend does not hand work to computers (`503 AGENTS_UNSUPPORTED`); production uses SQLite.
