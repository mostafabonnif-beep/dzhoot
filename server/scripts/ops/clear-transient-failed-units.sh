#!/usr/bin/env bash
# ينظّف وحدات systemd الفاشلة التي تركتها اختبارات تشغيلية عابرة.
#
# لماذا هذا الملف؟ في 2026-09-13 أنشأ اختبار يدوي لوحدة `dzhoof-test-fail.service`
# (اختبار لمسار `OnFailure=dzhoof-alert-failure@%n.service`)، وهي وحدة **عابرة**
# (transient) تعيش في /run وتشغّل /bin/true.. /bin/false عمداً. بقيت في حالة failed،
# فصار `systemctl --failed` يعرض وحدة دائماً — وهذا يخفي أي فشل حقيقي لاحق.
#
# هذا السكربت مقصور على الوحدات العابرة (تلك التي في /run) والمملوكة لهذا المشروع،
# ولا يلمس أي خدمة إنتاجية. شغّله على خادم الإنتاج فقط بموافقة تشغيلية صريحة:
#
#   ./scripts/ops/clear-transient-failed-units.sh --dry-run   # عرض ما سيحدث
#   ./scripts/ops/clear-transient-failed-units.sh             # تنفيذ
#
# Environment:
#   NAME_PATTERN=...   نمط أسماء الوحدات المسموح تنظيفها (افتراضياً dzhoof-* / dzhoot-*)
set -Eeuo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

NAME_PATTERN="${NAME_PATTERN:-^(dzhoof|dzhoot)-}"

say() { printf '[clear-failed] %s\n' "$*"; }
die() { printf '[clear-failed][ABORT] %s\n' "$*" >&2; exit 1; }

command -v systemctl >/dev/null || die "systemctl غير متاح"
[ "$(id -u)" -eq 0 ] || die "شغّله كـ root (reset-failed يتطلب ذلك)"

# الوحدات الفاشلة فقط: `--failed` يطبع صفوفاً مثل "● name.service loaded failed failed …"
mapfile -t FAILED < <(systemctl list-units --failed --no-legend --plain --no-pager 2>/dev/null | awk '{print $1}')

if [ "${#FAILED[@]}" -eq 0 ]; then
  say "لا توجد وحدات فاشلة — لا شيء لتنظيفه."
  exit 0
fi

say "وحدات فاشلة: ${#FAILED[@]}"
cleared=0
skipped=0

for unit in "${FAILED[@]}"; do
  [ -n "$unit" ] || continue

  if ! printf '%s' "$unit" | grep -Eq "$NAME_PATTERN"; then
    say "تخطٍّ (خارج النمط $NAME_PATTERN): $unit"
    skipped=$((skipped + 1))
    continue
  fi

  # الأمان: ننظّف الوحدات العابرة فقط (ملفها في /run). أي وحدة دائمة تُبلَّغ ولا تُلمس،
  # لأن حالة failed عليها مؤشر حقيقي يحتاج فحصاً لا مسحاً.
  unit_file="$(systemctl show -p FragmentPath --value "$unit" 2>/dev/null || true)"
  case "$unit_file" in
    /run/*)
      if [ "$DRY_RUN" -eq 1 ]; then
        say "[dry-run] سيُنظّف: $unit (transient, ${unit_file:-no-file})"
      else
        systemctl reset-failed "$unit" && say "نُظّف: $unit"
      fi
      cleared=$((cleared + 1))
      ;;
    *)
      say "تخطٍّ (ليست عابرة، افحصها): $unit (file=${unit_file:-none})"
      skipped=$((skipped + 1))
      ;;
  esac
done

say "النتيجة: نُظّف $cleared، تُخطّي $skipped (بوضع dry-run=$DRY_RUN)"

if [ "$DRY_RUN" -eq 0 ]; then
  remaining="$(systemctl list-units --failed --no-legend --plain --no-pager 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$remaining" = "0" ]; then
    say "systemctl --failed صار فارغاً — لن تختفي أي وحدة فاشلة حقيقية بعده."
  else
    say "تحذير: ما زالت هناك $remaining وحدة فاشلة (معظمها ليست عابرة — افحصها)."
  fi
fi
