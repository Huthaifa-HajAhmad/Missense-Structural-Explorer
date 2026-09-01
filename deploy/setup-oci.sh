#!/usr/bin/env bash
# ==============================================================================
# setup-oci.sh — Automated Provisioning Script for Oracle Cloud Infrastructure
# Sets up Docker, UFW firewall (deny all incoming except SSH), 4GB swap, and cron
# ==============================================================================

set -euo pipefail

echo "======================================================================"
echo " Missense-Structural-Explorer (MissensResolve) - OCI Provisioning"
echo "======================================================================"

if [ "$EUID" -ne 0 ]; then
    echo "[-] Please run as root: sudo bash deploy/setup-oci.sh"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ------------------------------------------------------------------------------
# 1. Configure 4GB Swap Space (Essential for memory stability during builds)
# ------------------------------------------------------------------------------
if [ ! -f /swapfile ]; then
    echo "[+] Configuring 4GB swap file on NVMe block storage..."
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q "/swapfile" /etc/fstab; then
        echo "/swapfile none swap sw 0 0" >> /etc/fstab
    fi
    echo "[+] Swap configured successfully."
else
    echo "[*] Swap file already exists. Skipping."
fi

# ------------------------------------------------------------------------------
# 2. System Update & Essential Tooling
# ------------------------------------------------------------------------------
echo "[+] Updating system packages..."
apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    sqlite3 \
    rclone \
    ufw \
    git

# ------------------------------------------------------------------------------
# 3. Install Docker CE & Docker Compose Plugin
# ------------------------------------------------------------------------------
if ! command -v docker &> /dev/null; then
    echo "[+] Installing official Docker CE repository..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo "[+] Docker CE installed successfully."
else
    echo "[*] Docker already installed. Skipping."
fi

# ------------------------------------------------------------------------------
# 4. Strict Firewall Posture (Zero Open Web Ports)
# ------------------------------------------------------------------------------
echo "[+] Configuring strict UFW firewall (Inbound deny all except SSH)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw --force enable
echo "[+] Firewall active. Inbound web ports are closed (Tunnel is outbound-only)."

# ------------------------------------------------------------------------------
# 5. Directory Layout & Permissions
# ------------------------------------------------------------------------------
echo "[+] Preparing persistent data directories..."
mkdir -p "${APP_ROOT}/data"
mkdir -p "${APP_ROOT}/logs/foldx_cache"
mkdir -p "${APP_ROOT}/tools/foldx"
mkdir -p "${APP_ROOT}/backups"
chmod +x "${SCRIPT_DIR}/backup-sqlite.sh"

# Create .env.oci from example if not already present
if [ ! -f "${SCRIPT_DIR}/.env.oci" ]; then
    cp "${SCRIPT_DIR}/.env.example.oci" "${SCRIPT_DIR}/.env.oci"
    echo "[+] Created ${SCRIPT_DIR}/.env.oci from template."
    echo "[!] IMPORTANT: Edit ${SCRIPT_DIR}/.env.oci and add your TUNNEL_TOKEN before launching."
fi

# ------------------------------------------------------------------------------
# 6. SQLite Live Backup Cron Job (Daily at 03:00 AM)
# ------------------------------------------------------------------------------
CRON_JOB="0 3 * * * root bash ${SCRIPT_DIR}/backup-sqlite.sh >> ${APP_ROOT}/logs/backup.log 2>&1"
CRON_FILE="/etc/cron.d/mse-sqlite-backup"
echo "$CRON_JOB" > "$CRON_FILE"
chmod 644 "$CRON_FILE"
echo "[+] Configured daily SQLite backup cron job at /etc/cron.d/mse-sqlite-backup."

echo "======================================================================"
echo " Provisioning Complete!"
echo " Next Steps:"
echo " 1. Copy your academic FoldX 5 binary into tools/foldx/"
echo " 2. Edit deploy/.env.oci with your TUNNEL_TOKEN and security keys"
echo " 3. Launch stack: docker compose -f deploy/docker-compose.oci.yml up -d --build"
echo "======================================================================"
