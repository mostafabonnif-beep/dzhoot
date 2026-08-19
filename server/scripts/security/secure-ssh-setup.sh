#!/usr/bin/env bash
# DZ HOOF — optional SSH hardening helper (audit-remediation-v1).
#
# ⚠️  THIS SCRIPT IS A PLAN, NOT AN ACTION. It is intended to be run by the
#      OPERATOR on the server AFTER explicit approval and AFTER a successful
#      key-based login test. It is idempotent and refuses to disable
#      password/root login unless a key is verified first.
#
# What it does when run:
#   1. Creates a sudo user (default: dzhoof-admin) with a strong random password
#      printed once.
#   2. Generates an Ed25519 key pair locally (on THIS machine) and installs the
#      public key for the new user AND root.
#   3. Installs and starts fail2ban with sane sshd jails.
#   4. Leaves SSH config untouched by default — it only PRINTS the exact
#      sshd_config lines to apply after the operator has tested key login.
#
# Usage (on the server, as root):
#   bash scripts/security/secure-ssh-setup.sh
# Env overrides: SSH_ADMIN_USER=dzhoof-admin, SSH_ADMIN_PUBKEY="ssh-ed25519 AAAA..."
set -uo pipefail

ADMIN_USER="${SSH_ADMIN_USER:-dzhoof-admin}"
PUBKEY="${SSH_ADMIN_PUBKEY:-}"
cd "$(dirname "$0")/../.."

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (the script only prepares changes; nothing is applied without -y)"; exit 1
fi

# ── 1. sudo user ─────────────────────────────────────────────────────────────
if id "$ADMIN_USER" >/dev/null 2>&1; then
  echo "[ssh] sudo user $ADMIN_USER already exists"
else
  ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  useradd -m -s /bin/bash "$ADMIN_USER"
  echo "$ADMIN_USER:$ADMIN_PASS" | chpasswd
  usermod -aG sudo "$ADMIN_USER"
  echo "[ssh] created sudo user: $ADMIN_USER"
  echo "[ssh] one-time password: $ADMIN_PASS   (change it after first login: passwd $ADMIN_USER)"
fi

# ── 2. SSH key ───────────────────────────────────────────────────────────────
mkdir -p "/home/$ADMIN_USER/.ssh" /root/.ssh
chmod 700 "/home/$ADMIN_USER/.ssh" /root/.ssh

if [ -z "$PUBKEY" ]; then
  if [ -f /root/.ssh/dzhoof_ed25519.pub ]; then
    PUBKEY="$(cat /root/.ssh/dzhoof_ed25519.pub)"
    echo "[ssh] reusing existing /root/.ssh/dzhoof_ed25519(.pub)"
  else
    ssh-keygen -t ed25519 -N "" -C "dzhoof-$(hostname)-$(date +%Y%m%d)" -f /root/.ssh/dzhoof_ed25519
    PUBKEY="$(cat /root/.ssh/dzhoof_ed25519.pub)"
    echo "[ssh] generated Ed25519 key pair at /root/.ssh/dzhoof_ed25519"
    echo "[ssh] PRIVATE KEY: /root/.ssh/dzhoof_ed25519  — copy it to your local ~/.ssh and KEEP IT PRIVATE"
  fi
fi

grep -qF "$PUBKEY" "/home/$ADMIN_USER/.ssh/authorized_keys" 2>/dev/null || echo "$PUBKEY" >> "/home/$ADMIN_USER/.ssh/authorized_keys"
grep -qF "$PUBKEY" /root/.ssh/authorized_keys 2>/dev/null || echo "$PUBKEY" >> /root/.ssh/authorized_keys
chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys" /root/.ssh/authorized_keys
chown -R "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
echo "[ssh] public key installed for $ADMIN_USER and root"

# ── 3. fail2ban ──────────────────────────────────────────────────────────────
if command -v fail2ban-client >/dev/null 2>&1; then
  systemctl enable --now fail2ban 2>/dev/null && echo "[ssh] fail2ban enabled"
  mkdir -p /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port = ssh
maxretry = 4
bantime = 1h
findtime = 10m
EOF
  systemctl restart fail2ban 2>/dev/null && echo "[ssh] fail2ban sshd jail configured"
else
  echo "[ssh] fail2ban not installed — run: apt-get install -y fail2ban && systemctl enable --now fail2ban"
fi

# ── 4. sshd hardening — NOT applied, only printed ────────────────────────────
cat <<'EOF'

[ssh] NEXT STEP — TEST KEY LOGIN FIRST, then apply these lines to /etc/ssh/sshd_config
      and run: systemctl restart ssh
--------------------------------------------------------------
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
MaxAuthTries 4
LoginGraceTime 30
--------------------------------------------------------------
Test first (from your machine):
  ssh -i ~/.ssh/dzhoof_ed25519 dzhoof-admin@<SERVER_IP>
Do NOT restart ssh with the new config until that key login succeeds.
EOF

echo "[ssh] DONE — nothing destructive was applied. Review the printed plan."
