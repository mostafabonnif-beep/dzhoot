#!/usr/bin/env bash
# DZ HOOF — SSH hardening preparation helper.
#
# This script prepares a key-only sudo administrator but never changes
# sshd_config. It does not generate, print, or store private keys or passwords.
# Test the new account in a second SSH session before hardening sshd manually.
#
# Usage:
#   SSH_ADMIN_PUBKEY="ssh-ed25519 AAAA... operator@device" \
#     bash scripts/security/secure-ssh-setup.sh --apply
#
# Optional override: SSH_ADMIN_USER=dzhoof-admin
set -Eeuo pipefail

ADMIN_USER="${SSH_ADMIN_USER:-dzhoof-admin}"
PUBKEY="${SSH_ADMIN_PUBKEY:-}"
APPLY=0

if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
fi

usage() {
  cat <<'EOF'
Usage:
  SSH_ADMIN_PUBKEY="ssh-ed25519 AAAA... operator@device" \
    bash scripts/security/secure-ssh-setup.sh --apply

The script creates or updates a locked-password sudo user with the supplied
public key. It does not alter sshd_config and it does not print secrets.
EOF
}

if [[ "$APPLY" -ne 1 ]]; then
  usage
  echo "Refusing to modify SSH access without --apply."
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ ! "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "Invalid SSH_ADMIN_USER." >&2
  exit 1
fi

if [[ ! "$PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))[[:space:]]+[A-Za-z0-9+/=]+([[:space:]].*)?$ ]]; then
  echo "SSH_ADMIN_PUBKEY must be a valid public OpenSSH key; private keys are never accepted." >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required before creating the administrator account." >&2
  exit 1
fi

if id "$ADMIN_USER" >/dev/null 2>&1; then
  echo "[ssh] sudo user $ADMIN_USER already exists"
else
  useradd --create-home --shell /bin/bash --groups sudo "$ADMIN_USER"
  passwd --lock "$ADMIN_USER" >/dev/null
  echo "[ssh] created locked-password sudo user: $ADMIN_USER"
fi

install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
touch "/home/$ADMIN_USER/.ssh/authorized_keys"
chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"
chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"
grep -qF -- "$PUBKEY" "/home/$ADMIN_USER/.ssh/authorized_keys" || printf '%s\n' "$PUBKEY" >> "/home/$ADMIN_USER/.ssh/authorized_keys"

# The account has no password; sudo therefore relies on possession of its SSH
# key. Keep this narrowly scoped to the named administrator account.
install -d -m 750 /etc/sudoers.d
printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$ADMIN_USER" > "/etc/sudoers.d/$ADMIN_USER"
chmod 440 "/etc/sudoers.d/$ADMIN_USER"
visudo -cf "/etc/sudoers.d/$ADMIN_USER" >/dev/null

echo "[ssh] key-only sudo access prepared for $ADMIN_USER"

if command -v fail2ban-client >/dev/null 2>&1; then
  install -d -m 755 /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port = ssh
maxretry = 4
bantime = 1h
findtime = 10m
EOF
  systemctl enable --now fail2ban
  systemctl restart fail2ban
  echo "[ssh] fail2ban sshd jail enabled"
else
  echo "[ssh] fail2ban is not installed; install it separately before hardening sshd."
fi

cat <<EOF

[ssh] NEXT STEPS — DO NOT SKIP THE KEY-LOGIN TEST
1. From a separate terminal, test the new account and sudo access:
   ssh -i ~/.ssh/<private-key> ${ADMIN_USER}@<SERVER_IP> 'sudo -n true'
2. Keep the current root session open while testing.
3. Only after the test succeeds, back up /etc/ssh/sshd_config and apply:

   PermitRootLogin prohibit-password
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   ChallengeResponseAuthentication no
   UsePAM yes
   MaxAuthTries 4
   LoginGraceTime 30

4. Validate before reload: sshd -t && systemctl reload ssh

Root key authentication remains enabled so the existing Upstream reverse tunnel is
not interrupted. Rotate the exposed root password only after the alternate
key login has been verified.
EOF
