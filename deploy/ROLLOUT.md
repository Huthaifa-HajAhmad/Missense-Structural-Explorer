# Production handover

`python3 deploy/rollout.py --commit <full Git SHA>` builds an immutable image, starts an
isolated standby, and keeps the existing generation available throughout warm-up. It requires
Linux, Python 3, Docker Compose, the existing OCI environment file, and the shared Docker network.
The script acquires the host deployment lock; CD acquires the same lock **before checkout** and
passes its descriptor to the detached driver. Concurrent checkouts/builds cannot race.

The standby shares persistent analyses, job records, and caches, but has its own sidecar and
temporary calculation directories. Its SQLite scheduler, crash recovery, and reaper are disabled.
It can read job results and accept jobs without resetting work owned by the serving generation.
Redis handovers are refused until an equivalent ownership protocol is implemented.

After the standby reports the expected revision and a ready VESM sidecar, the driver copies the
old generation's immutable assets, pauses the old scheduler, reloads Caddy, and checks the public
version endpoint. Existing requests stay on their upstream; new requests go to the standby.
The old app must report **zero requests, active calculations, and background tasks** before the
standby's worker is enabled. Queued work then continues on the new worker. Finally, the old
container is stopped. A candidate's promoted role survives a container restart.

Readiness has a 10-minute limit; draining has a 30-minute limit. Caddy allows old streams to live
for 35 minutes across reloads. A failed readiness check leaves the old app serving. A failed drain
restores its route and scheduler without aborting work. A lost activation response first requires
the candidate to pause and drain before the old worker resumes. If this cannot be established,
both containers are retained and the journal says `needs_attention`; the driver never guesses
that it is safe to run two workers. After confirmed ownership transfer, cleanup failure retains
the new serving generation and records `cleanup_pending` rather than routing to a stopped app.

The candidate is capped at 4 GiB during overlap, with at least 5 GiB of host memory available
before launch. On successful handover it gets the normal 10 GiB limit. Insufficient headroom
defers the update. These guards reduce the risk of host exhaustion but cannot guarantee that
unrelated host processes or an unexpected workload will never consume the reserve.

## One-time bootstrap

The currently deployed pre-handover app cannot report active work. **The new driver refuses to
replace it automatically.** Schedule the first baseline update for a confirmed idle maintenance
window, let active analyses finish, and deploy the new app/control protocol in place once. Start
Caddy using the updated Compose command (`--resume`) and load the updated Caddyfile. After that,
all updates must use the handover driver; do not use `docker compose up --build` on the active app.
The bootstrap is an operator action, not a hidden fallback in automatic deployment.

An initial CD run against the legacy app is expected to stop in `refused` before building or
replacing a container. That app may return the SPA's HTML for the unknown control endpoint.
This does not mean the deployed app is unhealthy; compare the public health/version endpoints
and complete bootstrap before retrying. A retry alone cannot add the missing protocol.

Bootstrap checklist for the operator (do not execute while analyses are running):

1. Arrange the maintenance window and stop new analysis submissions. Confirm with users that
   running analyses have finished; the legacy version cannot supply trustworthy drain counters.
2. Hold the same host deployment lock across preparation and replacement. Record the current
   app image ID and proxy configuration; take a consistent SQLite backup using SQLite's backup
   API rather than copying a live database file. Preserve the existing licensed assets.
3. Build the CI-validated target image before replacing the serving container. Set `BUILD_COMMIT`
   to its exact checked-out SHA and `BUILD_TIME` to the UTC build time. Do not proceed on build failure.
4. With the idle condition still confirmed, replace only the baseline app using the updated
   Compose definition. Verify loopback control reports protocol 1, SQLite, `paused: false`, the
   expected commit, and `ready: true` with `?probe=true` before ending maintenance.
5. Recreate only Caddy with the updated `--resume` command, preserving its named data/config
   volumes. Explicitly reload the updated Caddyfile: `--resume` can otherwise retain the old
   autosaved configuration. Validate the configuration before reloading.
6. Verify the public health and revision endpoints, then complete an analysis. If readiness
   fails, keep maintenance open and restore the recorded baseline image/proxy configuration;
   do not enable a second worker. Resume normal submissions only after these checks pass.
7. Run subsequent updates through the handover driver. A CD retry at the already-serving
   revision should finish as an idempotent success once the app protocol and proxy are bootstrapped.

Caddy uses its autosaved configuration on restart, retaining the selected generation. The
default Caddyfile is only the bootstrap configuration. The driver reads the live Caddy admin
configuration rather than trusting a stale journal or assuming which slot serves traffic.
The optional Cloudflare tunnel profile is not supported by this handover. A running tunnel
container makes preflight refuse the update because its origin topology cannot be verified.
Supporting that profile requires routing it through the stable Caddy proxy and adding a verified
preflight for that topology. Until then, tunnel deployments require planned maintenance.

## Observe and recover

`deploy/runtime/rollout.json` is an atomic, credential-free journal containing the revision,
phase, active generation, candidate, and timestamp. The host build log ends with `DEPLOY_OK` or
`DEPLOY_FAILED`; a GitHub run that reaches its short confirmation limit only confirms dispatch.
`cleanup_pending` means the new generation serves traffic but retirement needs attention.
`needs_attention` means exclusive worker ownership or safe draining could not be verified.
Inspect the live Caddy upstream, each container's loopback control response and role file before
resuming anything; never force-stop a container just to clear a rollout timeout.

Read status with `docker exec <app-container> node -e` and fetch
`http://127.0.0.1:3000/internal/deployment/`. POST `/pause` and `/resume` controls require an actual
loopback peer, and Caddy rejects `/internal/*`. Forwarded IP headers cannot authorize controls. Browser-origin requests are rejected, including on localhost, to prevent cross-site control requests during development.
Status includes `protocol`, `commit`, `paused`, `activeRequests`, `activeJobs`, `backgroundTasks`,
and `backend`; `?probe=true` also checks sidecar readiness. No provider keys are needed.

The runtime logger drops all request headers while retaining endpoint, status, duration and error
details. This also protects custom provider credentials in **proxy error logs**, which are not
covered by filtering access logs alone. Previously logged keys must be rotated separately by
their owner; the deployment cannot rotate user-provided credentials.

Shared database migrations must remain backward-compatible across the overlap. Breaking schema
changes require a maintenance migration rather than a handover. Large model changes may require
more memory or a separate sidecar deployment; do not weaken readiness to force an update.

Run the driver failure-path tests with `python -m unittest discover -s deploy -p 'test_rollout.py'`.
Queue handover, persisted roles, and loopback control regression tests run in the normal Vitest
suite. Before production bootstrap, rehearse on an isolated Docker host with a live NDJSON stream,
a running FoldX job, a failing candidate, and a proxy restart. Existing work must finish, queued
job IDs must survive, old assets must remain available, and no two workers may process concurrently.

## Validation on October 1, 2026

Lint/type checking, the full application suite with coverage, both geometry harnesses, the complete production build,
the ten deployment failure-path tests, YAML parsing, the host's Compose parser, and the installed
Caddy parser passed. Seventeen targeted application/queue tests also passed.

An isolated Docker rehearsal used the actual SQLite queue and deployment-control implementation,
a simulated calculation, and a live NDJSON stream. The stream finished across the proxy reload;
the running job finished on its original worker; the queued job ran on the promoted worker;
app and proxy restarts retained the worker role and selected route. A deliberately failed
upstream confirmed that a synthetic provider credential was absent from Caddy's error logs.
All rehearsal containers, their network, and their test database volume were removed.
This did not route production traffic, rotate keys, or exercise real ML inference under overlap.
