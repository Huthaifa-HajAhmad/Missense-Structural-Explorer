# Accounts and server jobs: owner runbook

For whoever runs the server. It covers creating the first admin, inviting people, switching on
sign-in, and the settings that decide how server jobs are shared. Each step says what you should see.
Design background: [`COMPUTE_ROUTING_PLAN.md`](./COMPUTE_ROUTING_PLAN.md), sections 4 and 0.4.

## How access works

The live site is `https://missense-resolve.duckdns.org`. **Caddy** runs on the server, answers on ports
80 and 443, gets the HTTPS certificate from Let's Encrypt and passes requests to the app
(`Caddyfile`, `deploy/docker-compose.oci.yml`). There is **no Cloudflare in front of it**: the
`tunnel` service in the compose file is an optional profile that is not running, and the rollout
driver refuses to deploy while it is.

Who may do what is decided by **the app's own login**, set with `AUTH_MODE`:

| `AUTH_MODE` | Reading results | Running anything (every write) |
|---|---|---|
| `legacy` (default) | anyone | anyone; the `APP_API_TOKEN` check covers few routes |
| `hybrid` | anyone | a signed-in person, **or** a caller holding `APP_API_TOKEN` (a script, or a browser with the token in Settings → Connections) |
| `accounts` | anyone | a signed-in person only. Signed-out visitors get the sign-in page. |

In `legacy` mode anyone who finds the address can queue FoldX and pocket jobs on your server, and
every job belongs to "legacy", so per-person limits, **My jobs** and usage do nothing. Switching to
`accounts` closes that.

## Applying a setting

Settings live in `deploy/.env.oci` on the server. Compose reads that file only when it **creates** a
container, so `docker restart` does not apply a change. Never run `docker compose up` on the live
app either, because it skips the drain and cuts off running jobs. Instead, from the app's directory
on the server:

```bash
python3 deploy/rollout.py --restart --commit "$(git rev-parse HEAD)"
```

This is the normal handover (`deploy/ROLLOUT.md`), with the same revision. It starts a fresh copy
with the new settings, waits for it to be ready, moves traffic to it, lets running jobs finish on the
old copy, then stops the old one. It ends with `[CD] DEPLOY_OK`. Any later deploy also picks up the
file, so you can simply wait for the next merge instead. (On a single Windows host run with PM2,
`doc/DEPLOY.md`, the app reads `.env` and `pm2 restart missense-fold` applies it.)

To check what the server is using, open `https://missense-resolve.duckdns.org/api/v1/auth/session`.
`mode` is the current `AUTH_MODE`.

## 1. Create your admin account

1. Make a secret of at least 16 characters:
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
2. Add it to `deploy/.env.oci` as `ADMIN_SETUP_SECRET=...`, and apply it (see above).
3. Open `https://missense-resolve.duckdns.org/setup`. Enter the secret, your email, your name and a
   password of at least 12 characters.
   - You are signed in, and **Settings → Team** opens.
   - If the page says setup is not available, either the secret did not reach the server or an
     account already exists. `/api/v1/auth/session` shows `setupAvailable`.
4. Remove `ADMIN_SETUP_SECRET` from `.env.oci` whenever convenient. `/setup` stops working
   anyway once an account exists.

## 2. Invite people

1. **Settings → Team → Invite someone.** Enter their email and choose **Member** or **Admin**.
2. Copy the link it shows and send it to them yourself (there is no email service).
   - Links work once and expire after **3 days**.
   - The token is after `#` in the link, so it never appears in a server or proxy log.
3. They open the link, choose their name and a password, and are signed in.
4. Check: they appear under **People** on the Team page with a recent "last signed in".

Unused invites are listed under **Waiting to join**, where you can withdraw them.

## 3. Switch on sign-in

With people able to sign in, step `AUTH_MODE` up, applying each change as above:

1. `AUTH_MODE=hybrid`: people sign in to run anything, while scripts and browsers holding
   `APP_API_TOKEN` still work. Use this while you find whatever still relies on the token.
2. `AUTH_MODE=accounts`: everything that runs work needs a signed-in person. `APP_API_TOKEN` can
   only read.

If you are the only user, go straight from `legacy` to `accounts`.

**Rollback:** set `AUTH_MODE=legacy` (or `hybrid`) and apply. Accounts and sessions are kept, so
switching back on later needs no re-invites.

## Day to day (Settings → Team)

- **Forgotten password:** **Reset link** on the person's row. The link lasts 24 hours and works once.
  Using it signs them out everywhere else and clears any lock-out.
- **Locked out:** 5 wrong passwords for one email lock it for 15 minutes; 20 from one network do the
  same for that network. A reset link unlocks at once.
- **Someone leaves:** **Disable**. They are signed out everywhere and their waiting and running jobs
  are cancelled. Their account and history are kept, and you can enable it again.
- **Sign out everywhere:** for a lost laptop. Their password does not change.
- **The last admin** cannot be disabled or made a member. Make someone else an admin first.

People manage their own password and preferences in **Settings → Account**.

## Server jobs and limits

FoldX and pocket jobs wait in one queue. The **My jobs** button in the header shows each person's
jobs with their place in the queue, an estimated wait and **Cancel**. When two people ask for the
same result they share one job, and cancelling only withdraws your interest while someone else is
still waiting for it. An admin's cancel always stops the job.

| Setting | Default | What it does |
|---|---|---|
| `QUOTA_QUEUED_PER_USER` | 25 | Waiting jobs per person **while others are waiting too**. Someone alone may queue up to `QUEUE_MAX_TOTAL − 5`, leaving room for a colleague who arrives. An admin can give one person a fixed limit. |
| `QUEUE_MAX_TOTAL` | 50 | Waiting plus running jobs across everyone; protects the server. |
| `QUOTA_SERVER_SECONDS_PER_DAY` | unset (no cap) | A daily server-time allowance per person; resets 00:00 UTC. |
| `BIOPHYSICAL_CONCURRENCY` | 4 | Jobs running at once. FoldX's own limit is `min(BIOPHYSICAL_CONCURRENCY, CPUs − 1)` when this is unset (1 on the 2-core server, where Box64 makes two FoldX runs slower than one), and **this value exactly when it is set** — so setting it to 4 on the 2-core server also raises FoldX to 4. Leave it unset there. |
| `JOB_RETENTION_DAYS` | 14 | Finished jobs are deleted after this long. |
| `TELEMETRY_RETENTION_DAYS` | 180 | Job timing records, used for wait estimates, are deleted after this long. |
| `COMPUTE_ROUTING` | `shadow` | `off`, `shadow` or `on`; see below. |

Each person can see their own server time for today and the last 7 days in **Settings → Account**.

### `COMPUTE_ROUTING`: from `shadow` to `on`

In `shadow` the server works out whether each job can run here, logs the answer, and refuses
nothing. Before switching to `on`, read a few days of those lines:

```bash
docker ps --format '{{.Names}}' | grep missense-resolve-   # the serving app container
docker logs <that container> 2>&1 | grep '\[routing:shadow\]'
```

Check that no line says FoldX or P2Rank is missing on the server, and how often a job would have been
refused for size. With `on`, a job that cannot run here is refused with a plain message (HTTP 422)
instead of running out of memory.

At start-up the server runs FoldX and P2Rank once and logs what it found, with versions:

```bash
docker logs <that container> 2>&1 | grep '\[host-probe\]'
# [host-probe] FoldX 5.1 passed its self-test (build valid until 2026-12-31); P2Rank 2.6-alpha passed its self-test.
```

A tool that "could not be started" or "failed its self-test" counts as missing: with `on`, its jobs
are refused with that reason. Once, before `on`, measure the server itself (about 10 minutes, best
when nobody is running jobs) and keep the numbers in the repository:

```bash
docker exec -it <that container> npm run compute:benchmark -- --out /app/data
docker cp <that container>:/app/data/compute-benchmark/. doc/compute-benchmark/   # on the host, in the checkout
npm run compute:benchmark -- --render   # on a development machine, then commit doc/
```

`doc/COMPUTE_BENCHMARK.md` then shows the server's real FoldX and P2Rank times and memory beside the
engine's estimates. From then on every job also records its own peak memory, so the engine learns
memory as well as time.

The server learns a size limit only after **two** out-of-memory failures, and forgets failures after
30 days. If a learned limit is wrong (for example, the server got more memory), an admin can clear it
with `DELETE /api/v1/admin/compute/ceilings`; a button for it is planned with live routing (WP-G2).

## Team members' own computers

People can lend their own computer to their own FoldX and pocket jobs (**Settings → Account → Your
computers**); the admin can share the licensed FoldX with those computers (**Settings → Team → FoldX for the
team**), and remove it again at any time. Everything about it, including how to make the agent downloadable,
is in `doc/AGENT.md`.

## Backups

`deploy/backup-sqlite.sh` copies `data/analyses.sqlite` and `data/accounts.sqlite` safely while the
app runs, keeps 14 days in `backups/`, and syncs them off the server when an `rclone` remote is
configured. `deploy/setup-oci.sh` schedules it daily at 03:00. `accounts.sqlite` holds logins
(password hashes only). If it is lost, everyone has to be invited again.

To restore, never copy over the live file, because the app holds it open. Unzip the backup next to it
(for example `gunzip -c backups/accounts_<date>.sqlite.gz > data/accounts-restored.sqlite`), set
`ACCOUNTS_DB_PATH=data/accounts-restored.sqlite` and apply. The new copy of the app opens the
restored file.

## Settings reference

All optional unless marked. `.env.example` has the same list with comments.

| Setting | Default | Notes |
|---|---|---|
| `AUTH_MODE` | `legacy` | `legacy`, `hybrid`, `accounts`. |
| `AUTH_PROVIDER` | `password` | The app's own login; the only one built. |
| `ADMIN_SETUP_SECRET` | none | Opens `/setup` while no account exists. At least 16 characters. |
| `PUBLIC_BASE_URL` | `https://missense-resolve.duckdns.org` | The address used in invite and reset links. |
| `ACCOUNTS_DB_PATH` | `data/accounts.sqlite` | |
| `SESSION_TTL_DAYS`, `SESSION_IDLE_HOURS` | 14, 24 | A sign-in lasts at most 14 days, and ends after 24 hours unused. |
| `APP_API_TOKEN` | **required in production** | The shared token. Read-only once `AUTH_MODE=accounts`. |
| `AGENT_LEASE_SEC`, `AGENT_HEARTBEAT_SEC` | 60, 20 | A computer's job returns to the server if its lease is not renewed. |
| `TOOL_BUNDLES_DIR` | `data/tool-bundles` | The team FoldX bundle (doc/AGENT.md). |
| `AGENT_BUNDLE_DIR` | `data/agent-bundles` | Agent zips offered for download in Settings → Account. |
| `AGENT_ACCEPTED_FOLDX_VERSIONS`, `AGENT_ACCEPTED_P2RANK_VERSIONS` | none | Comma-separated; refuse computers' results from other versions. |

The startup check refuses to start on an unknown `AUTH_MODE`, a short `ADMIN_SETUP_SECRET` or an
invalid `PUBLIC_BASE_URL`, and says which one.

## FoldX licence

FoldX is licensed for academic, non-commercial research. This deployment runs it for a small research
team on that basis (the owner's statement). The binary is not in the repository and is not
redistributed by default: it is mounted from `tools/foldx_linux` on the server. Anyone setting up their own copy
must get their own licence from <https://foldxsuite.crg.eu/>. The one exception is the team bundle an admin
chooses to upload for team members' own computers (`doc/AGENT.md`), which records the admin's licence
confirmation and can be removed from every computer with one button.

The academic builds stop working on the date in their file name (`foldx_20261231` works until
31 December 2026). The `[host-probe]` line names that date and warns from 45 days before it; once the
day has passed, the probe marks FoldX as failed, so with `COMPUTE_ROUTING=on` its jobs are refused with
that reason. (If the mounted binary's name carries no date, the line says so — the warning is then not
armed, and the first sign of an expired build would be failing jobs.) To renew, download the current
build, put it in `tools/foldx_linux` in place of the old one, and apply it with the handover
(`--restart`, above).
