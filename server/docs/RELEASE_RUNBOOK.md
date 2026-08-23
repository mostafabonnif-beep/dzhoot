# DZ HOOF IPTV — Release Runbook

هذا الدليل مخصص لإطلاق نسخة إنتاجية أو Release Candidate. يجب تنفيذ الخطوات على خادم مخول، مع حفظ الأسرار في مدير أسرار أو ملفات خارج المستودع بصلاحيات `0600`.

## 1. متطلبات ما قبل النشر

يجب تجهيز Docker وDocker Compose وDNS للنطاق الرسمي، والتأكد من أن المنفذين 80 و443 متاحان لـCaddy. اضبط `DOMAIN` و`ACME_EMAIL` و`APP_URL` و`PUBLIC_BASE_URL` و`ALLOWED_ORIGINS` على النطاق نفسه، ولا تستخدم القيم التجريبية الموجودة في النموذج.

أنشئ كل سر بشكل مستقل، ولا تعِد استخدام سر التطوير:

```bash
openssl rand -hex 32 # XTREAM_SECRET_KEY
openssl rand -hex 32 # JWT_ACCESS_SECRET
openssl rand -hex 32 # JWT_REFRESH_SECRET
openssl rand -hex 32 # PLAYBACK_TOKEN_SECRET
openssl rand -hex 32 # TOTP_ENCRYPTION_KEY
```

يجب حفظ بيانات Firebase وBrevo وOAuth وSentry في مدير الأسرار أو ملف بيئة خارج Git. لا تضع `google-services.json` أو `.env.production` الحقيقي في المستودع.

## 2. التحقق قبل التشغيل

من مجلد `server`، تحقق من Compose مع ملف البيئة الحقيقي دون طباعة الأسرار:

```bash
docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml config >/tmp/dzhoof-compose.rendered.yml
```

راجع أن خدمة API تتلقى `XTREAM_SECRET_KEY` و`PLAYBACK_TOKEN_SECRET` و`TOTP_ENCRYPTION_KEY` و`FCM_*` و`PUBLIC_BASE_URL` و`ALLOWED_ORIGINS`. يجب أن تكون `SUBSCRIPTION_REQUIRED=true`، وأن تكون مسارات legacy proxy معطلة.

## 3. النشر والتحديث

استخدم tag أو digest ثابتًا للصورتين بدل `latest`، ثم شغل:

```bash
docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml pull

docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml up -d
```

لا تفتح الحركة العامة قبل نجاح الفحوص التالية:

```bash
curl --fail --silent https://$DOMAIN/health/live
curl --fail --silent https://$DOMAIN/health/ready
curl --fail --silent 'https://$DOMAIN/health?details=true'
```

يجب ألا تسجل Caddy أو التطبيق query strings التي تحتوي على playback tokens أو روابط المصادر الأصلية.

## 4. النسخ الاحتياطي

أنشئ ملفًا خارج المستودع مثل `/etc/dzhoot/backup.env` بصلاحية `0600`:

```bash
MONGODB_URI='mongodb://mongodb:27017/dzhoof-iptv'
BACKUP_DIR='/var/backups/dzhoot/mongodb'
RETENTION_DAYS='14'
ALERT_WEBHOOK_URL=''
```

جدولة النسخ اليومية عبر cron على حساب خدمة مخصص:

```cron
15 3 * * * . /etc/dzhoot/backup.env && /opt/dzhoot/server/scripts/backup.sh >> /var/log/dzhoot-backup.log 2>&1
```

بعد إنشاء النسخة، انسخها إلى تخزين منفصل ومشفر مع checksum. وجود ملف في نفس الخادم لا يعتبر خطة تعافٍ كاملة.

## 5. Restore Drill قبل الإطلاق

نفذ الاستعادة في MongoDB منفصلة، ولا تستخدم URI الإنتاج. مثال التشغيل:

```bash
export ALLOW_RESTORE_DRILL=true
export BACKUP_FILE=/var/backups/dzhoot/mongodb/dzhoot-mongodb-YYYYMMDDTHHMMSSZ.archive.gz
export MONGODB_URI='mongodb://mongodb:27017/dzhoof-iptv'
export MONGODB_RESTORE_URI='mongodb://restore-mongodb:27017/dzhoof-restore-drill'
./server/scripts/restore-drill.sh
```

بعد النجاح، تحقق من عدد المستخدمين والمصادر والباقات والأكواد وسجلات التدقيق، ثم شغل نسخة اختبارية من API وتحقق من `/health/ready` وتسجيل الدخول والكتالوج والتشغيل. سجل حجم النسخة، مدة الاستعادة، RTO، RPO، وأي اختلافات في `server/docs/workflow/restore-drill-log.md`.

## 6. Smoke وQA بعد النشر

نفذ المسار التجاري من حساب اختبار: تسجيل الدخول، إنشاء أو اختيار خطة، redeem، ربط جهاز، `authorize` قبل التشغيل، تشغيل قناة أو VOD، انتهاء الاشتراك، ثم إظهار بوابة التفعيل. اختبر كذلك تفعيل 2FA وتعطيله، وإرسال FCM من لوحة الإدارة إلى جهاز Android فعلي.

## 7. التراجع

احتفظ بالـimage digest السابق وملف البيئة السابق في مساحة محمية. عند ظهور عطل حرج، أوقف الحركة الجديدة، أعد تشغيل tag السابق، تحقق من `/health/ready` ثم نفذ Smoke المختصر قبل إعادة فتح الخدمة. لا تستخدم `--drop` في MongoDB الإنتاجية ضمن rollback أو restore إلا بعد موافقة موثقة وخطة منفصلة.

## 8. Production-readiness gate: device tokens and channel lifecycle

لا تنشر الفرع `fix/production-readiness` تلقائياً. يجب أن تتم مراجعة pull request وموافقة المالك قبل أي release، ولا يغير عمل التطوير هذا أسراراً أو كلمات مرور أو إعدادات VPS.

| شرط الدخول | دليل القبول |
|---|---|
| المراجعة | مراجعة security لمسار device token وlegacy gates |
| CI | نتائج typecheck وlint والاختبارات موثقة وناجحة، أو قيود البيئة معلنة بوضوح |
| البيانات | backup صالح؛ تم تنفيذ lifecycle migration كـdry-run ومراجعة الناتج |
| الأسرار | لا توجد `.env` أو مفاتيح أو APK signing outputs في commit |
| المحتوى | مصادر مرخصة فقط ولا توجد source URLs خامة في responses |

### Staging قبل الإنتاج

1. استخدم أسرار staging منفصلة واضبط `ALLOW_LEGACY_TV_CODE=false` و`ALLOW_LEGACY_PLAYBACK_TOKEN=false`.
2. شغّل migration lifecycle بوضع dry-run فقط، وراجع تصنيف active وpending وdegraded وdisabled قبل أي كتابة.
3. فعّل جهاز Android اختباري وتحقق من إرسال `X-Device-Token` ومن إصدار `pt2` دون تسريب الرمز في logs.
4. اختبر التشغيل، HLS nested manifests، دوران device token، حساباً معطلاً، واشتراكاً منتهياً.
5. تحقق أن catalog لا يعرض سوى `lifecycleStatus=active`، وأن عمليات الإزالة في الإدارة تسمى أرشفة وقابلة للاستعادة.

### قبول ما بعد النشر

| الاختبار | النتيجة المتوقعة |
|---|---|
| device token سليم | مزامنة وتشغيل ضمن اشتراك فعال |
| token مبطل أو منتهٍ | 401 |
| مستخدم معطل أو اشتراك منتهٍ | 403 عند التشغيل |
| channelListCode أو `pt1` مع legacy مغلق | 410 أو رفض واضح |
| catalog غير `active` | لا يظهر للعميل |
| طلب أرشفة | audit log وcache invalidation؛ لا حذف فيزيائي |

### التراجع الخاص بهذا الإصدار

التراجع الأول هو إعادة artefact السابق المعروف الصالح وفق القسم 7، **وليس** إضعاف الضوابط أو تمكين التوافق القديم بشكل غير محدود. إذا أثبتت المراقبة وجود عميل legacy تعاقدي لا يمكن ترحيله فوراً، يمكن فتح نافذة توافق مؤقتة بالرايتين المناسبتين مع تاريخ انتهاء ومالك مسؤول ومراقبة للطلبات. لا تُعرض روابط المصادر ولا تُطبع الأسرار.

إذا كانت migration قد كتبت بيانات بعد موافقة منفصلة، استعد backup أو نفّذ rollback migration مراجعاً؛ لا تعدّل MongoDB يدوياً تحت الضغط.

راجع أيضاً [PLAYBACK_SECURITY.md](./PLAYBACK_SECURITY.md)، [DEVICE_TOKEN_MIGRATION.md](./DEVICE_TOKEN_MIGRATION.md)، و[CHANNEL_OPERATIONS.md](./CHANNEL_OPERATIONS.md).
