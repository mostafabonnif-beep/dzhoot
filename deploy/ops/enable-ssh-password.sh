#!/usr/bin/env bash
# =============================================================================
# DZ HOOF — تفعيل الدخول بكلمة المرور عبر SSH (للاتصال من Windows PowerShell)
# السيرفر: 5.196.51.152  (vps0cnshe.oct-xpd1.xyz / iptv.ld-11.net)
#
# شغّله من داخل كونسول OVH (KVM) أو من أي جلسة SSH تعمل عندك حاليًا:
#     sudo bash enable-ssh-password.sh 'oussamab123'
#     sudo bash enable-ssh-password.sh 'oussamab123' --user-only    # الأفضل أمنيًا
#
# ملاحظة: هذا تخفيض أمني متعمّد (يفتح باب التخمين على الكلمة).
#         fail2ban سيبقى مفعّلًا للتخفيف، ويمكن الرجوع بأمر واحد (أسفل الملف).
# =============================================================================
set -euo pipefail

NEW_PASS="${1:-}"
MODE="${2:-open-all}"          # open-all | --user-only
SUDO_USER_NAME="${SUDO_USER_NAME:-dzadmin}"

if [ -z "$NEW_PASS" ]; then
  echo "الاستخدام: sudo bash $0 '<كلمة-المرور>' [--user-only]" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "لازم تشغيل السكربت بـ sudo/root." >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/ssh-backup-$STAMP"
CONF="/etc/ssh/sshd_config.d/99-dzhoof-password.conf"

echo "==> 1/6 نسخة احتياطية للإعدادات في $BACKUP"
mkdir -p "$BACKUP"
cp -a /etc/ssh/sshd_config "$BACKUP/" 2>/dev/null || true
[ -d /etc/ssh/sshd_config.d ] && cp -a /etc/ssh/sshd_config.d "$BACKUP/" || true

echo "==> 2/6 كتابة إعدادات المصادقة"
{
  echo "# DZ HOOF — دخول بكلمة المرور (أُنشئ في $STAMP)"
  echo "# الرجوع: rm $CONF && systemctl restart ssh ssh.socket"
  echo "PasswordAuthentication yes"
  echo "KbdInteractiveAuthentication yes"
  echo "PubkeyAuthentication yes"
  echo "MaxAuthTries 4"
  echo "LoginGraceTime 30"
  if [ "$MODE" = "--user-only" ]; then
    echo "PermitRootLogin prohibit-password"
  else
    echo "PermitRootLogin yes"
  fi
} >"$CONF"
chmod 600 "$CONF"

echo "==> 3/6 ضبط كلمات المرور"
if [ "$MODE" = "--user-only" ]; then
  if ! id "$SUDO_USER_NAME" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$SUDO_USER_NAME"
    usermod -aG sudo "$SUDO_USER_NAME"
    echo "$SUDO_USER_NAME ALL=(ALL) NOPASSWD:ALL" >"/etc/sudoers.d/90-$SUDO_USER_NAME"
    chmod 440 "/etc/sudoers.d/90-$SUDO_USER_NAME"
  fi
  echo "$SUDO_USER_NAME:$NEW_PASS" | chpasswd
  echo "    المستخدم: $SUDO_USER_NAME (sudo بلا كلمة مرور)"
else
  echo "root:$NEW_PASS" | chpasswd
  echo "    المستخدم: root"
fi

echo "==> 4/6 تأكيد أن fail2ban شغّال (حماية من التخمين)"
if command -v fail2ban-client >/dev/null 2>&1; then
  systemctl is-active --quiet fail2ban || systemctl enable --now fail2ban
  fail2ban-client status sshd 2>/dev/null || echo "    (jail sshd غير مضبوط — يُنصح بإضافته)"
else
  echo "    fail2ban غير مثبّت — يُنصح بتثبيته: apt-get install -y fail2ban"
fi

echo "==> 5/6 التحقق من صحة الإعداد قبل التطبيق"
sshd -t
echo "    OK"

echo "==> 6/6 إعادة تشغيل sshd"
systemctl restart ssh 2>/dev/null || systemctl restart sshd
systemctl restart ssh.socket 2>/dev/null || true   # Ubuntu 24.04 يعمل بـ socket activation
sleep 1
ss -tlnp | grep -E ':22\b' || true
sshd -T 2>/dev/null | grep -E '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication)' || true

echo
echo "تم ✅"
if [ "$MODE" = "--user-only" ]; then
  echo "من Windows PowerShell:  ssh $SUDO_USER_NAME@5.196.51.152"
else
  echo "من Windows PowerShell:  ssh root@5.196.51.152"
fi
echo
echo "للرجوع للوضع القديم (DABL فقط):"
echo "  rm $CONF && systemctl restart ssh ssh.socket && rm -rf $BACKUP"
