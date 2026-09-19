# Missense-Structural-Explorer: Oracle Cloud (OCI Always Free) Deployment Guide

This guide details the complete production deployment of **Missense-Structural-Explorer** (MissensResolve) and its full biophysical engine (**FoldX 5**, **P2Rank**, **ThermoMPNN**, **RaSP**, and **ESM-2/SaProt**) to an **Oracle Cloud Infrastructure (OCI) Always Free Ampere A1 (ARM64)** instance, secured for your team via **Cloudflare Zero Trust Tunnels**.

---

## 1. System Architecture & Resource Blueprint

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TEAM ACCESS & ZERO TRUST                           │
│                                                                             │
│   Team Members (Browser) ──────► https://missenseresolve.yourdomain.com     │
│                                            │                                │
│                              [Cloudflare Zero Trust SSO]                    │
│                                            │                                │
│                       Encrypted Outbound Tunnel (cloudflared)               │
└────────────────────────────────────────────┬────────────────────────────────┘
                                             │
┌────────────────────────────────────────────▼────────────────────────────────┐
│                     ORACLE CLOUD ALWAYS FREE VM (ARM64)                     │
│         [Ubuntu 24.04 Host • 2 OCPUs Ampere A1 • 12 GB RAM • 200GB NVMe]    │
│         [UFW: Inbound Deny All Except SSH (22) • Outbound Tunnel Only]      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 📦 Combined Application Container (missense-resolve-app)              │  │
│  │     [Base: node:22-bookworm-slim • Debian 12 • Python 3.11]           │  │
│  │                                                                       │  │
│  │  🌐 Node.js 22 Express Engine (Port 3000)                             │  │
│  │     • Serves React UI & Server-Sent Events (SSE) Progress Streams     │  │
│  │     • Supervises Python Sidecar on Loopback (127.0.0.1:8000)          │  │
│  │                                                                       │  │
│  │  ⚡ Unified Python Biophysics Sidecar (127.0.0.1:8000)                │  │
│  │     • ThermoMPNN (Official Kuhlman weights — ~2–4s CPU inference)     │  │
│  │       Canonical Route: POST /predict/thermompnn                       │  │
│  │     • ESM-2 / SaProt / VESM / StabilityOracle Embeddings              │  │
│  │     • RaSP Precomputed SQLite Database                                │  │
│  │                                                                       │  │
│  │  🔬 Native Tools & Translators                                        │  │
│  │     • P2Rank Pocket Predictor (OpenJDK 17 JRE ARM64 Native)           │  │
│  │     • FoldX 5 (Executed via Box64 v0.4.4 dynamic translator)          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 🔒 Cloudflare Tunnel Container (missense-resolve-tunnel)              │  │
│  │     • Outbound-only tunnel connecting localhost:3000 to Cloudflare Edge│ │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Oracle Cloud Setup & Provisioning

### Step 2.1: Always Free Tenancy & PAYG Strategy
1. Sign up for an **Oracle Cloud Infrastructure (OCI)** account.
2. **Upgrade to Pay-As-You-Go (PAYG)**:
   * *Why:* Pure Always Free accounts frequently encounter *"Out of host capacity"* in popular regions and are subject to idle instance reclamation.
   * *Cost:* Upgrading to PAYG requires a credit card verification, but **your bill is \$0.00** as long as you stay within the Always Free allocation.
   * *Allowance:* Up to **2 OCPUs and 12 GB RAM** total across Ampere A1 instances + **200 GB NVMe block volume**. *(Note: Oracle halved the Always Free A1 allocation from 4 OCPUs / 24 GB in June 2026.)*

### Step 2.2: Create the Ampere A1 Compute Instance
In the OCI Console:
1. Navigate to **Compute** -> **Instances** -> **Create Instance**.
2. **Image:** Select `Canonical Ubuntu 24.04 Minimal` or `Canonical Ubuntu 24.04 LTS (aarch64)`.
3. **Shape:** Click *Change Shape* -> **Ampere (ARM)** -> `VM.Standard.A1.Flex`:
   * **OCPUs:** `2`
   * **Memory:** `12 GB`
4. **Networking:** Select your default VCN and Public Subnet.
5. **SSH Keys:** Paste your public SSH key (`id_ed25519.pub` or `id_rsa.pub`).
6. **Boot Volume:** Check *Specify custom boot volume size* -> Set to `100 GB` or `200 GB`.
7. Click **Create**.

---

## 3. Cloudflare Zero Trust Tunnel Setup

### Step 3.1: Domain & Tunnel Creation
1. Ensure your custom domain (e.g., `yourlab.org`, cost ~$10/yr) is active on Cloudflare DNS.
2. Open the **Cloudflare Zero Trust Dashboard** (`dash.zero-trust.cloudflare.com`).
3. Go to **Networks** -> **Tunnels** -> **Create a Tunnel**.
4. Select **Cloudflared** connector -> Name it `missense-resolve`.
5. Under *Install and run a connector*, copy the tunnel token from the command (`--token <YOUR_TUNNEL_TOKEN>`).
6. Under the **Public Hostname** tab:
   * **Subdomain:** `missenseresolve` (or root)
   * **Domain:** `yourdomain.com`
   * **Type:** `HTTP`
   * **URL:** `missense-resolve-app:3000`

### Step 3.2: Configure Team Access Policy
1. In Cloudflare Zero Trust Dashboard, go to **Access** -> **Applications** -> **Add an application** -> **Self-hosted**.
2. **Application Name:** `Missense Structural Explorer`
3. **Domain:** `missenseresolve.yourdomain.com`
4. **Policy Rules:**
   * Action: `Allow`
   * Include: `Emails ending in` `@youruniversity.edu` OR `Emails` (list team email addresses).
5. Team members will receive a one-time 6-digit PIN by email or log in via Google/Microsoft SSO.

---

## 4. Server Installation & Deployment

### Step 4.1: SSH into your OCI Instance
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<YOUR_OCI_INSTANCE_IP>
```

### Step 4.2: Clone Repository & Run Provisioning Script
```bash
git clone https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer.git
cd Missense-Structural-Explorer

# Run the automated system setup (Installs Docker CE, 4GB swap, UFW firewall, and backup cron)
sudo bash deploy/setup-oci.sh
```

### Step 4.3: Add Academic FoldX Binaries
Copy your licensed FoldX 5 academic files into `tools/foldx/`:
```bash
# On your local machine:
scp -r ./tools/foldx/* ubuntu@<YOUR_OCI_IP>:~/Missense-Structural-Explorer/tools/foldx/
```
Ensure `tools/foldx/foldx` (Linux executable), `rotabase.txt`, and `molecules/` exist.

### Step 4.4: Configure Production Secrets
Edit `deploy/.env.oci`:
```bash
nano deploy/.env.oci
```
Populate the required secrets:
```bash
# Core Settings
NODE_ENV=production
PORT=3000

# Security Tokens (Generate via: openssl rand -hex 32)
APP_API_TOKEN=<32_byte_hex_token>
APP_SESSION_SECRET=<32_byte_hex_secret>
SIDECAR_SECRET=<32_byte_hex_secret>

# Cloudflare Tunnel Token
TUNNEL_TOKEN=<YOUR_CLOUDFLARE_TUNNEL_TOKEN>

# Allowed Web Origins
ALLOWED_ORIGINS=https://missenseresolve.yourdomain.com

# Biophysics Provider
THERMOMPNN_PROVIDER=local
```

### Step 4.5: Launch Container Stack
```bash
docker compose -f deploy/docker-compose.oci.yml up -d --build
```

### Step 4.6: (Optional) Enable Automated GitHub Actions CD
To automate deployments whenever you push to `main`:
1. In your GitHub repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
2. Add the following repository secrets:
   - `OCI_SSH_HOST`: Your OCI instance public IP (e.g. `92.5.173.166`).
   - `OCI_SSH_USER`: `ubuntu`.
   - `OCI_SSH_KEY`: The private SSH key matching the public key on your OCI VM (`id_ed25519` / `id_rsa`).
3. The workflow defined in `.github/workflows/cd.yml` will automatically pull latest changes and rebuild/restart the container stack on each push to `main`.


---

## 5. Operations, Security & Monitoring

### Checking Service Logs & Health
```bash
# View combined application logs
docker compose -f deploy/docker-compose.oci.yml logs -f missense-resolve-app

# View tunnel connection logs
docker compose -f deploy/docker-compose.oci.yml logs -f tunnel

# Test local health probe
curl -f http://localhost:3000/api/v1/health
```

### Firewall Posture
The OCI instance runs a strict **deny-all inbound** policy via UFW. The tunnel creates an outbound TLS connection to Cloudflare:
```bash
sudo ufw status verbose
# Status: active
# Logging: on (low)
# Default: deny (incoming), allow (outgoing)
# 22/tcp ALLOW IN Any
```

### Automated Live Database Backups & Offsite Sync (Cloudflare R2)
`deploy/setup-oci.sh` registers a daily cron job at 03:00 AM running `deploy/backup-sqlite.sh`.
* **Local Atomic Dumps**: Backups of `data/analyses.sqlite` are safely created via `sqlite3 .backup` without locking queries and rotated locally (14-day retention).
* **Offsite Cloudflare R2 Sync (10GB Free Tier)**:
  To protect against total instance loss, configure `rclone` once on the host:
  ```bash
  rclone config
  # 1. New remote -> Name: r2
  # 2. Type: s3
  # 3. Provider: Cloudflare
  # 4. Access Key ID & Secret Access Key: (from Cloudflare R2 API Tokens)
  # 5. Endpoint: https://<account_id>.r2.cloudflarestorage.com
  ```
  Once configured, `backup-sqlite.sh` automatically syncs daily snapshots to your private R2 bucket (`r2:missense-resolve-backups`) with \$0 storage and zero egress fees.

---

## 6. Performance Expectations & Benchmarks on OCI Ampere A1

| Tool / Model | Architecture & Runtime | Expected Execution Time | Notes |
| :--- | :--- | :--- | :--- |
| **ThermoMPNN** | PyTorch CPU (ARM NEON) | **~2–4 seconds** | Official weights (`thermoMPNN_default.pt`). Canonical route: `POST /predict/thermompnn`. |
| **FoldX 5 (BuildModel)** | x86_64 via Box64 v0.4.4 | **~15–30 seconds** | 5 independent runs; dynamic FP recompilation. |
| **P2Rank** | Java 17 OpenJDK (ARM64 Native) | **~10–25 seconds** | Full ligand pocket binding prediction. |
| **RaSP** | SQLite Precomputed Database | **< 5 milliseconds** | Indexed lookup over the bundled precomputed set — **8,331,709 variants across 1,345 proteins**, not the whole proteome. A protein outside that set reports "not covered", which is a property of the dataset rather than a fault. Check real coverage with `GET /api/v1/capabilities` (`indexedProteins`). |
| **ESM-2 (650M) / SaProt** | PyTorch CPU (ARM64) | **~3–8 seconds** | Deep sequence embedding & zero-shot evaluation. |

---

## 7. Architecture Roadmap: Tracked Enhancements

* **Decoupled Microservice Clustering (`SIDECAR_URL`)**:
  * *Current (Option A):* Node.js and the Python sidecar run together in one container over loopback (`127.0.0.1:8000`).
  * *Future Follow-up:* Parameterizing `SIDECAR_URL` across all backend service files will allow deploying the Python model server to dedicated GPU nodes (e.g. RunPod, Modal, or local RTX workstation) while keeping the web app on OCI.
