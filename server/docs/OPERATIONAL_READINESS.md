# بوابة الجاهزية التشغيلية

يوفر `scripts/ops/operational-readiness.sh` فحصاً **قرائياً فقط** قبل الصيانة أو النشر. لا ينفذ حذف Docker، ولا ينشئ نسخة، ولا يستعيد قاعدة بيانات، ولا يعدل الإعدادات أو الحاويات. الغرض هو تحويل مخاطر التشغيل المتكررة إلى نتيجة قابلة للقراءة: صحة عامة، مساحة، حداثة النسخ، checksum، حالة الحاويات، ودليل النسخة الخارجية واستعادة الاختبار.

## التشغيل

شغّل الفحص من مجلد `server` بحساب يملك حق قراءة Docker والنسخ. لا تمرر URI أو أسرار أو webhook في سطر الأوامر.

```bash
cd /opt/dzhoot/server
sudo -E make ops-readiness
```

تستخدم القيم الافتراضية `https://iptv.ld-11.net` و`/var/backups/dzhoot/mongodb` و10 GiB كحد أدنى للمساحة الحرة. لا تتحول التحذيرات إلى فشل إلا عند طلب الوضع الصارم.

```bash
sudo -E STRICT=true \
  MAX_BACKUP_AGE_HOURS=26 \
  MIN_DISK_FREE_MB=10240 \
  make ops-readiness
```

| المتغير | القيمة الافتراضية | الاستخدام |
|---|---:|---|
| `BASE_URL` | `https://iptv.ld-11.net` | عنوان health العام. |
| `BACKUP_DIR` | `/var/backups/dzhoot/mongodb` | مكان أرشيفات MongoDB المحلية. |
| `MAX_BACKUP_AGE_HOURS` | `26` | أقصى عمر للنسخة المحلية قبل الفشل. |
| `MIN_DISK_FREE_MB` | `10240` | أقل مساحة حرة مقبولة. |
| `REQUIRE_RELEASE_METADATA` | `false` | اجعله `true` بعد نشر release-traceability للتحقق من commit ووقت البناء. |
| `OFFSITE_BACKUP_EVIDENCE` | فارغ | ملف evidence محلي حديث يثبت نجاح النسخ الخارجي؛ غيابه تحذير أو فشل في الوضع الصارم. |
| `RESTORE_DRILL_EVIDENCE` | فارغ | ملف evidence محلي لآخر restore drill ناجح. |
| `MAX_OFFSITE_EVIDENCE_AGE_HOURS` | `168` | الحد الأقصى لعمر evidence النسخ الخارجي. |
| `MAX_RESTORE_DRILL_AGE_DAYS` | `90` | الحد الأقصى لعمر evidence استعادة الاختبار. |
| `STRICT` | `false` | يحول التحذيرات إلى exit code `2`. |

## Evidence لا يحتوي أسراراً

لا تضع credentials أو محتوى نسخ أو URI داخل evidence. يكفي ملف نصي يذكر وقت التنفيذ، اسم عملية التخزين الخارجي، checksum أو object version، ونتيجة استعادة الاختبار. تحفظ هذه الملفات خارج Git وبصلاحية قراءة محدودة، مثل `/var/lib/dzhoot-ops/`.

```text
# restore-drill-2026-08-24.txt
completed_at=2026-08-24T18:00:00Z
archive_sha256=<checksum>
target=non-production-drill-db
result=success
rto_minutes=12
```

يمثل evidence دليلاً تشغيلياً فقط. لا يغني عن التحقق الفعلي من النسخة في التخزين الخارجي أو عن تنفيذ `restore-drill.sh` أو `restore-drill-docker.sh` على قاعدة غير إنتاجية.

## مسار التشغيل الصحيح

ابدأ بفحص `make ops-readiness`. عند الفشل، أصلح السبب المحدد قبل النشر أو الصيانة. عند النجاح مع تحذيرات، راجع التحذيرات؛ أهمها غياب identity للإصدار أو evidence الخارجي. بعد نجاح النسخ الجديدة، شغّل `verify-backup.sh`، ثم استعادة اختبار مع opt-in صريح، وسجل النتيجة في evidence. لا تشغّل `docker system prune` إلا بعد نسخة متحققة ونقطة rollback ونافذة صيانة.

## الخروج والجدولة

يعيد السكربت `0` عند النجاح، و`1` عند وجود فشل، و`2` عندما ينجح الفحص التقني لكن الوضع الصارم وجد تحذيرات. يمكن تشغيله يدوياً قبل النشر، أو من مؤقت نظام قائم، لكن هذه الحزمة **لا تضيف جدولة تلقائية** ولا وجهة تنبيه. أضف أي مؤقت أو webhook في تغيير منفصل بعد اعتماد سياسة التنبيهات ووجهة الاستلام.
