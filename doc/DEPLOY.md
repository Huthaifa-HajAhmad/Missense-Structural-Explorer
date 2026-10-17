# Production Deployment Runbook — Missense & Fold

This document outlines the step-by-step procedure to deploy the Missense & Fold Explorer application as a reliable, secure internal single-tenant lab tool on a Windows host.

---

## Prerequisites

1. **Node.js**: Install Node.js LTS (v22+ required for built-in `node:sqlite` support).
2. **PM2**: Install globally via npm:
   ```bash
   npm install -g pm2
   ```
3. **Caddy**: Download Caddy for Windows and add it to your System PATH:
   - https://caddyserver.com/download
4. **FoldX 5.x License**: FoldX is license-bound and cannot be pre-bundled.
   - Register and download FoldX 5.x for Windows from https://foldxsuite.crg.eu/
   - Download the molecules parameters collection.

---

## Onboarding Checklist

### Step 1: Place Licensed FoldX Binaries
1. In the repository root, ensure the directory `tools/foldx/` exists.
2. Place the licensed `foldx.exe` (or rename the downloaded version e.g. `foldx_1_20270131.exe`) inside `tools/foldx/`.
3. Extract the FoldX parameter library `molecules` directory into `tools/foldx/molecules/`.
4. Ensure the helper script `tools/foldx/foldx.cmd` points to the correct executable name (e.g. `"%~dp0foldx_1_20270131.exe" %*`).

> [!WARNING]
> These files are excluded by `.gitignore` and must **never** be committed to Git.

### Step 2: Configure Environment Secrets (`.env`)
Create a production `.env` file in the project root:
```ini
# Primary Gemini model. Simplest is to comment BOTH lines out: the shipped ladder is
# what the synthesis budget is sized and tested against, and the request round-robins
# it anyway. A pinned model is only the tie-break, and a pinned GEMINI_MODEL_FALLBACKS
# list *replaces* the shipped ladder entirely — the earlier advice here named
# `gemini-2.5-pro`, which the API now rejects with 404 "no longer available to new
# users", so a deployment that followed it had no working candidate.
# GEMINI_MODEL="gemini-3.6-flash"
# GEMINI_MODEL_FALLBACKS=

# Path to FoldX binary (or leave blank to auto-detect from tools/foldx)
FOLDX_BINARY=""

# Local dbNSFP store (data/dbnsfp_v5.sqlite). Unset or "true": used when the file is populated (a 0-byte
# placeholder or an empty table is ignored). "false": never used; scores then come from the remote sources.
# Build it with tools/rebuild_dbnsfp.sh and gate it with tools/verify_dbnsfp.sh (see the dbNSFP section of
# doc/VARIANT_QUERY_AND_PIPELINE_AUDIT_PLAN.md). Rows whose gene lists no MANE Select or canonical
# transcript are never served. Status: /api/v1/diagnostics -> dbnsfp, /api/v1/capabilities -> dbnsfp_local.
ENABLE_LOCAL_DBNSFP="true"

# Candidate coordinate-resolver rungs (local dbNSFP, ProtVar) evaluated beside the live ladder and only
# counted, never served; counters appear under `resolverShadow` in /api/v1/diagnostics. Unset = on.
# RESOLVER_SHADOW_TIERS="off"
# Log disagreeing coordinates in production too (they are logged outside production by default).
# RESOLVER_SHADOW_LOG_VARIANTS="true"

# Node Environment
NODE_ENV="production"
PORT=3000

# App URL and CORS configuration
APP_URL="https://localhost"
ALLOWED_ORIGINS="https://localhost"

# Gemini API Key (obtain from https://aistudio.google.com/app/apikey)
GEMINI_API_KEY="your-real-ai-studio-api-key"

# Secure random tokens (generate unique ones for your deploy)
# Generate via: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
APP_API_TOKEN="generated-24-byte-token"

# Generate via: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_SESSION_SECRET="generated-32-byte-session-secret"

# Secret key for sidecar inter-process authentication (optional, auto-generated at startup if left blank)
SIDECAR_SECRET=""

# Optional token used to authenticate requests to the BioHub ESM3 API
BIOHUB_API_TOKEN="your_biohub_api_token_here"

# Accounts: start in legacy, create the first admin at /setup, then step to accounts.
# The full procedure and every related setting are in doc/ACCOUNTS.md.
AUTH_MODE="legacy"
AUTH_PROVIDER="password"
ADMIN_SETUP_SECRET="16-or-more-random-characters"
PUBLIC_BASE_URL="https://localhost"
```

> This guide is for a single Windows host. The production server (Oracle Cloud, Docker, blue/green
> handover) is described in [`deploy/ROLLOUT.md`](../deploy/ROLLOUT.md).

### Step 3: Build & Bundle the Application
Clean install dependencies, compile the TypeScript backend, and build the React frontend:
```bash
npm ci
npm run build
```

### Step 4: Run Under PM2 Supervision
Launch the server under PM2 supervision with the production environment profile:
```bash
pm2 start ecosystem.config.cjs --env production
```
Verify the process status:
```bash
pm2 list
pm2 logs missense-fold
```

#### Windows Reboot Persistence
To ensure the process automatically revives upon a system reboot:
1. Install the PM2 startup service for Windows:
   ```bash
   npm install -g pm2-windows-startup
   pm2-startup install
   ```
2. Save the current process list:
   ```bash
   pm2 save
   ```

### Step 5: Start Caddy Reverse Proxy & CA Trust
Run Caddy to proxy traffic from port 80/443 to port 3000 and handle automatic TLS termination:
```bash
caddy run --config Caddyfile
```

#### Client CA Trust Setup
Since Caddy will issue an internal CA certificate for `localhost` (or your internal domain), client browsers on the local network will show a "Certificate Authority Invalid" warning until the certificate is trusted:
1. Double-click the root certificate generated by Caddy at `C:\Users\<user>\AppData\Roaming\Caddy\pki\authorities\local\root.crt`.
2. Click **Install Certificate...** -> Select **Local Machine** -> Place all certificates in the **Trusted Root Certification Authorities** store.
3. Restart the browser.

### Step 6: Switch On Accounts
Follow [`ACCOUNTS.md`](./ACCOUNTS.md): create the first admin at `/setup`, invite people from
**Settings → Team**, then set `AUTH_MODE=accounts`. On this host the server reads `.env` when it
starts, so apply a change with `pm2 restart missense-fold`. To roll back, set `AUTH_MODE=legacy` and
restart again.

### Step 7: Pace Calls to Remote Providers (`EGRESS_GOVERNOR`)
The team shares this server's IP, so providers count everyone as one client. `EGRESS_GOVERNOR` (default
`off`) controls the team-wide 429 pause and the fair-share governor (`doc/COMPUTE_ROUTING_PLAN.md`, WP-I3
and WP-I1):
1. Set `EGRESS_GOVERNOR=shadow` and restart. Nothing is held; each call that would have waited, and each
   pause that would have applied, is logged as `[egress:shadow]` (at most once a minute per provider) and
   counted under `egress` on `GET /api/v1/capabilities`.
2. After a few days, read those lines and the `wouldHold` / `rateLimits` counts. Fair share between people
   needs Step 6 (`AUTH_MODE=accounts`); under `legacy` everyone is one owner.
3. Set `EGRESS_GOVERNOR=on` and restart. To roll back, set it to `off`. Under `on`, a lookup that fails
   because a provider is limiting requests is answered from the saved copy when one exists, even past its
   expiry, and the reader is told how old it is (WP-I2). `staleServes` on `/capabilities` counts these
   (`wouldServe` under `shadow`). Expired cache rows are kept 30 days for this, so `data/analyses.sqlite`
   holds somewhat more than before.

Team tokens (WP-I4): `SHARED_TOKEN_FALLBACK` (`on`, `limited` or `off`; default `limited`) decides whether a person
without their own Biohub, Hugging Face or Tamarind token may use the server's (`BIOHUB_API_TOKEN`, `HF_TOKEN`,
`TAMARIND_API_KEY`). Under `limited` each signed-in person may make `SHARED_TOKEN_SHARE_PER_HOUR` (default 60)
team-token calls per provider per hour; without accounts it behaves like `on`. `/capabilities` shows the policy
under `egress.credentials`. People can save their own tokens to their account (Settings → Connections); that
needs `APP_SESSION_SECRET`, and changing it makes saved tokens unreadable until re-entered.

Optional: `EGRESS_PROVIDER_LIMITS_JSON` overrides a provider's `maxConcurrent`, `ratePerMin` or `burst`
(`.env.example`); a published rate cannot be raised by it. State is per process, so during a blue/green
hand-over the two processes count separately.

---

## Maintenance & Operations

### Health Probes
You can monitor the readiness of downstream engines by querying the health route:
```bash
curl http://localhost:3000/api/v1/health
```
Expected output:
```json
{
  "status": "ok",
  "timestamp": "2026-06-27T10:00:00.000Z",
  "foldxReady": true,
  "geminiReady": true
}
```

### Audit Log Rotation
Audit logs are written to `logs/audit.jsonl` and are automatically rotated by the application once the file exceeds 10MB (rotated to `audit.1.jsonl`). Server stdout and stderr logs are managed by PM2 and written to `logs/pm2-out.log` and `logs/pm2-err.log`. You can install the PM2 logrotate module to handle automatic logs compression and rotation for PM2's own logs:
```bash
pm2 install pm2-logrotate
```
