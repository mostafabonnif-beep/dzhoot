#!/usr/bin/env bash
# يثبّت jail الـfail2ban لطبقة الويب (Caddy) من نسخة المستودع.
#
# لماذا: كان تعريف الـjail موجوداً على خادم الإنتاج فقط (خارج المستودع)، فخادم جديد
# يبقى سجل Caddy فيه بلا مراقبة. واقتصر على 401/403، فحملة الطلبات المشوّهة التي
# أنتجت 75 خطأ Server Reference ID لم تُحظر لأن ردودها كانت 404/405.
#
# الاستعمال (على الخادم، كـroot):
#   ./scripts/security/setup-fail2ban-http-jail.sh --dry-run     # عرض ما سيحدث
#   ./scripts/security/setup-fail2ban-http-jail.sh              # تثبيت + إعادة تحميل
#
# Environment:
#   CADDY_ACCESS_LOG=…   مسار سجل Caddy (افتراضياً يُكتشف من حاويات دوكر)
#   JAIL_BANTIME/FINDTIME/MAXRETRY=…   قيم اختيارية للـjail
#
# يفشل-مغلق: لا يُعيد تحميل fail2ban إن لم يطابق الفلتر أي سطر في السجل الحقيقي، حتى
# لا يبدو الـjail فعّالاً وهو لا يطابق شيئاً.
set -Eeuo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTER_SRC="$SCRIPT_DIR/fail2ban/filter.d/dzhoof-http.conf"
JAIL_SRC="$SCRIPT_DIR/fail2ban/jail.d/dzhoof-http.local"
FILTER_DST="/etc/fail2ban/filter.d/dzhoof-http.conf"
JAIL_DST="/etc/fail2ban/jail.d/dzhoof-http.local"

MAXRETRY="${JAIL_MAXRETRY:-6}"
FINDTIME="${JAIL_FINDTIME:-60}"
BANTIME="${JAIL_BANTIME:-3600}"

say() { printf '[fail2ban-http] %s\n' "$*"; }
die() { printf '[fail2ban-http][ABORT] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "شغّله كـroot"
[ -f "$FILTER_SRC" ] || die "ملف الفلتر غير موجود: $FILTER_SRC"
[ -f "$JAIL_SRC" ] || die "ملف الـjail غير موجود: $JAIL_SRC"
command -v fail2ban-client >/dev/null || die "fail2ban غير مثبّت على هذا الخادم"
command -v fail2ban-regex >/dev/null || die "fail2ban-regex غير متاح (حزمة fail2ban)"

# --- 1) إيجاد سجل الوصول الحقيقي -------------------------------------------
if [ -z "${CADDY_ACCESS_LOG:-}" ]; then
  CADDY_ACCESS_LOG="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' dzhoof-caddy 2>/dev/null || true)"
  [ -n "$CADDY_ACCESS_LOG" ] && CADDY_ACCESS_LOG="${CADDY_ACCESS_LOG%/}/access.log"
fi
[ -n "${CADDY_ACCESS_LOG:-}" ] || die "تعذّر تحديد مسار سجل Caddy — مرّر CADDY_ACCESS_LOG=…"
[ -f "$CADDY_ACCESS_LOG" ] || die "سجل Caddy غير موجود: $CADDY_ACCESS_LOG"
say "سجل الوصول: $CADDY_ACCESS_LOG"

# --- 2) التحقق من الفلتر على السجل الحقيقي قبل أي تغيير ---------------------
say "التحقق من الفلتر (fail2ban-regex) قبل التثبيت…"
REGEX_OUT="$(mktemp)"; trap 'rm -f "$REGEX_OUT"' EXIT
if ! fail2ban-regex "$CADDY_ACCESS_LOG" "$FILTER_SRC" > "$REGEX_OUT" 2>&1; then
  sed -n '1,20p' "$REGEX_OUT" >&2
  die "fail2ban-regex فشل — الفلتر غير صالح، لم يُغيَّر شيء"
fi
MATCHED="$(grep -oE 'Lines: [0-9]+ lines, [0-9]+ ignored, [0-9]+ matched' "$REGEX_OUT" | tail -1 || true)"
say "النتيجة: ${MATCHED:-<غير معروفة>}"
if ! printf '%s' "$MATCHED" | grep -qE 'matched' || printf '%s' "$MATCHED" | grep -qE ' 0 matched'; then
  say "تنبيه: الفلتر لا يطابق أي سطر في هذا السجل الآن."
  say "هذا مقبول فقط إن لم يكن السجل يحتوي سلوكاً مخالفاً بعد. للتحقق:"
  say "  fail2ban-regex '$CADDY_ACCESS_LOG' '$FILTER_SRC' | tail -20"
  if [ "$DRY_RUN" -eq 0 ] && [ "${ALLOW_UNMATCHED:-0}" != "1" ]; then
    die "أوقف التثبيت لأن الفلتر لم يطابق شيئاً. استخدم ALLOW_UNMATCHED=1 إن كان هذا مقصوداً."
  fi
fi

# --- 3) التثبيت (مع نسخة احتياطية لأي تعريف قائم) ---------------------------
install_filter() {
  if [ -f "$FILTER_DST" ]; then
    BACKUP="${FILTER_DST}.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    install -m 644 "$FILTER_DST" "$BACKUP"
    say "نسخة احتياطية للفلتر: $BACKUP"
  fi
  install -m 644 "$FILTER_SRC" "$FILTER_DST"
  say "ثُبّت الفلتر: $FILTER_DST"
}

install_jail() {
  if [ -f "$JAIL_DST" ]; then
    BACKUP="${JAIL_DST}.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    install -m 644 "$JAIL_DST" "$BACKUP"
    say "نسخة احتياطية للـjail: $BACKUP"
  fi
  # استبدال المسار والقيم ثم التثبيت — يبقى الملف في المستودع مستقلاً عن مسار الخادم.
  sed -e "s|^logpath  = .*|logpath  = ${CADDY_ACCESS_LOG}|" \
      -e "s|^maxretry = .*|maxretry = ${MAXRETRY}|" \
      -e "s|^findtime = .*|findtime = ${FINDTIME}|" \
      -e "s|^bantime  = .*|bantime  = ${BANTIME}|" \
      "$JAIL_SRC" > "$JAIL_DST"
  chmod 644 "$JAIL_DST"
  say "ثُبّت الـjail: $JAIL_DST"
}

if [ "$DRY_RUN" -eq 1 ]; then
  say "[dry-run] سيُنفَّذ: install filter → install jail (logpath=$CADDY_ACCESS_LOG) → fail2ban-client reload"
  say "[dry-run] الحالة الحالية:"
  fail2ban-client status dzhoof-http 2>&1 | sed 's/^/    /' || say "    (الـjail غير محمّل حالياً)"
  exit 0
fi

install_filter
install_jail

# --- 4) إعادة التحميل والتحقق ----------------------------------------------
say "إعادة تحميل fail2ban…"
fail2ban-client reload 2>&1 | sed 's/^/    /' || die "fail2ban-client reload فشل"
sleep 2
fail2ban-client status dzhoof-http 2>&1 | sed 's/^/    /' || die "الـjail dzhoof-http لم يُحمَّل بعد إعادة التحميل"
say "تم. للمراقبة: fail2ban-client status dzhoof-http"
