# تقرير تسليم — R23 تثبيت واستقرار (STABILIZE) — 2026-09-09

> **النطاق**: 3 حزم — (A) تأمين الاعتماديات + إرجاع CI أخضر، (B) استقرار القرص
> وصدق `/health`، (C) تحكمات مشغّل VOD (مرجع Streambox P0). كل حزمة = PR مستقل.
> **الحالة النهائية**: 3 PRs جاهزة (#220/#221/#222) بلا دمج ولا نشر — بانتظار موافقة المالك.
> **الإنتاج**: لم يُمَس (يبقى على `c7c5fec`)، كل الحاويات healthy.

---

## ملخص الجلسة

| # | الحزمة | المرجع | PR | الحالة |
|---|---|---|---|---|
| A1 | ترقية الاعتماديات الأمنية (next 16.3.4 / multer 2.3.0 / nodemailer 9.1.1 / morgan 1.12.0 + قفل qs) | جلسة موازية (moclaw-agent) | **#219** (مدمج في main: `c39cb1b`) | ✅ مدمج — بوابة npm audit على main خضراء |
| A2 | إصلاح فشل backend tests على main (خروج Jest 1 رغم 570/570) | هذا التقرير | **#220** `fix/r23-backend-test-teardown` | ✅ **CI أخضر** — محليًا تشغيلان كاملان exit 0 |
| B | سكربت تنظيف Docker + تايمر أسبوعي + صدق `/health` | هذا التقرير | **#221** `fix/r23-disk-health-truth` | ✅ **CI أخضر** — مثبَّت ومُثبت حيًا على الخادم |
| C | تحكمات VOD: مؤقت نوم + نسبة أبعاد + سرعة 0.5×–2× | هذا التقرير | **#222** `feat/r23-vod-player-controls` | ✅ **CI أخضر** — APK artifact: `dzhoof-staging-production-apk` (~32.5MB) |

## A — الأمان والـ CI

- **A1 (منفذ بجلسة موازية ثم تحققت منه)**: الترقيات حلّت الثغرات: next
  16.0.0–16.3.2 (RCE حرجة)، multer ≤2.2.0 (4 DoS)، nodemailer ≤9.1.0، morgan، qs.
  `npm audit --omit=dev --audit-level=high` على main = **exit 0** (بقي moderate واحد فقط:
  qs 6.15.3 عبر express — غير مُسقط للبوابة).
- **A2 (تشخيصي وإصلاحي)**: الـ CI على main كان أحمر لسبب **ثانٍ** بعد #219: خطوة
  `npm run test:backend` — كل الـ 570 اختبارًا تنجح لكن Jest يخرج بكود 1 بسبب تسريب
  async في `hls-remux-service.test.ts`: `FakeProc.kill()` يصدر حدث `exit` عبر
  `setImmediate`، وعندما يشتغل بعد إغلاق وحدة تحكم jest يرمي
  `Cannot log after tests are done` (مصدره `console.error` في `hls-remux-service.ts:288`).
- **الإصلاح (#220)**: `afterEach` يستنزف دورة immediate واحدة داخل دورة حياة السويت.
  **التحقق**: السويت الكامل محليًا **75 suites / 570 passed / exit 0** (والمستهدف ×3 = exit 0).

## B — استقرار التشغيل

### القرص
- التشخيص: كل نشر +~2.1GB صور (api 1.65GB + frontend 483MB كـ current/versioned/rollback)
  بلا تنظيف مجدول؛ آخر حادثة امتلاء 2026-09-08 (تحرير 22GB يدويًا).
- **`server/scripts/cleanup-docker.sh`**: builder prune + image prune (غير مستخدمة
  >168h — الستاك الشغال لا يُمس) + إزالة rollback-* >14 يومًا + container prune؛
  سجل مساحة مُحرَّرة → `/var/log/dzhoot-docker-cleanup.log`.
- **تايمر systemd أسبوعي** (الإثنين 05:10 UTC + RandomDelay 300s) بنمط تايمرات restic.
- **مثبَّت ومُثبت حيًا على VPS**: `dzhoof-docker-cleanup.timer` active
  (Next: Mon 2026-09-14 05:13 UTC)؛ تشغيل يدوي نظيف (سجل 14:00:54Z — 0B حاليًا لأن
  كل الصور حديثة؛ الإفراج الفعلي يبدأ من الأسبوع القادم ومع النشرات التالية).
- ملاحظة: restic يحتفظ بسياسة keep-daily 7/weekly 4/monthly 3 مسبقًا — لا تغيير.

### صدق `/health`
- قبل: يحسب `ALERT_WEBHOOK_URL` فقط → `alertingConfigured:false` رغم تيليجرام مفعّل.
- بعد: يحسب webhook **أو** email **أو** تيليجرام (token+chat معًا) من AppSettings مع
  fallback للـ env، مع تعليق يربطه بـ `services/alert-notifier.ts`.
- اختباران جديدان في `health.test.ts` (6/6 أخضر)؛ typecheck ✅؛ lint 0 errors؛
  السويت الكامل (مع إصلاح A2): **75 suites / 572 passed / exit 0**.

### RELEASE_COMMIT
`.env.production` = `c7c5fec` — يطابق آخر نشر فعلي (تحقق: `/health` يعرض نفس الـ commit). ✅

## C — تحكمات مشغّل VOD (مرجع Streambox — أفكار فقط، تنفيذ DZ HOOF)

تحليل الفجوة على main: المشغّل الحي (TV quick actions + موبايل) يملك مؤقت نوم ونسبة
أبعاد فعلًا؛ **VOD كان ينقصه كلاهما** والسرعة كانت 0.75×–2× فقط.
- **مؤقت نوم VOD**: Off → 30/60/90/120 (خطوات مشتركة مع الحي)؛ عدّاد mm:ss حي على
  الشريحة؛ عند الصفر: إيقاف + نافذة 10 ثوانٍ «للمتابعة اضغط» قبل الخروج (يُحفظ التقدم).
- **نسبة أبعاد VOD**: ملاءمة → تكبير → ملء الشاشة عبر `ASPECT_MODES` المشترك،
  يُطبَّق على `resizeMode`.
- **السرعة**: 0.5×–2× (أُضيف 0.5×).
- اختبارات: `VodPlayerControlsTest` (جديد) + `VodPlaybackSpeedTest` (محدَّث).
- **قيود بيئية بدقة**: لا Android SDK/JDK 17 في بيئة العمل → لم يُبنَ محليًا؛ بوابة
  البناء وظيفة android في CI (lint + unit tests + APK staging بعنوان إنتاج).
  مسار APK: `android/app/build/outputs/apk/staging/debug/*.apk`؛ الإصدار الافتراضي 1.1.0.

## قرارات مطلوبة من المالك
1. **موافقة الدمج بالترتيب**: #220 أولًا (يعيد main أخضر) → ثم #221 → ثم #222.
   (#221 و#222 يتضمنان إصلاح الـ teardown مدمجًا مسبقًا — عند دمج #220 أولًا
   يختفي هذا الجزء تلقائيًا من فرقيهما دون تعارض.)
2. **النشر** (A1 أمني حرج + B تشغيلي): عند الإذن عبر `stage-release.sh` ثم
   `APPLY=1 atomic-deploy.sh` بقفل `/tmp/dzhoot-deploy.lock`.
3. البنود المعلّقة من تقرير الفحص 09-09 (خارج نطاق R23): مصادر NEO/MIBOX، EPG 54%،
   مفاتيح CinetPay/Chargily، صفحة ويب VOD، تدوير مفاتيح SSH/root، إصلاح تجميلي
   `alertingConfigured` في `collectHealthDetails` إن وُجد مسار آخر يعرضه.

## ملفات مرجعية
- `AUDIT_GAPS_REPORT_2026-09-09_AR.md` (تقرير الفحص) · `STREAMBOX_COMPETITIVE_REVIEW_2026-09-09_AR.md` (مرجع C)
- PRs: #219 (منفذ)، #220، #221، #222 (هذه الجلسة)

---

## ✅ التنفيذ النهائي (بعد موافقة المالك — 2026-09-09 ~15:10 UTC)

### الدمج
- **#220 / #221 / #222**: مدمجة في main (merge commits `32bc7b9`, `0256e48`, `3505103`).
- CI على main بعد الدمج: **أخضر بالكامل** (backend + frontend + android) عند 15:06 UTC.
- ملاحظة: دمجت محليًا ودفعت main لأن نقطة GitHub API للدمج أعادت 404 رغم صلاحيات
  admin (خلل بيئي) — GitHub تعرّف عليها كـ merged تلقائيًا (PRs closed/merged).

### النشر (بقفل /tmp/dzhoot-deploy.lock)
- `stage-release.sh` → `APPLY=1 atomic-deploy.sh 3505103e…` — نجح بلا rollback.
- النتيجة الحية:
  - الحاويات: api/frontend/scheduler على `dzhoof-*:current` الجديدة — **Up (healthy)**؛
    caddy/redis/mongo دون تغيير.
  - `/health` → `release.commit = 3505103e…` (builtAt 15:06:55Z).
  - **`/health?details=true` → `alertingConfigured: True`** — إصلاح صدق التنبيهات حي ✅
    (كان `false` سابقًا رغم تيليجرام المفعّل).
  - `server/scripts/cleanup-docker.sh` موجود في الشجرة النشطة + التايمر الأسبوعي active.
  - `RELEASE_COMMIT` في `/etc/dzhoot/.env.production` صحّحته يدويًا إلى 3505103
    (سكربت النشر يبني القيمة داخل الصورة؛ ملف البيئة لم يُحدَّث تلقائيًا — نفس ملاحظة جلسة 09-08).
  - القرص 64% بعد إضافة صور النشر الجديدة (~2.1GB) — متوقع؛ التنظيف الأسبوعي يديره.

### ملاحظات متبقية للمالك
- تغييرات Android (تحكمات VOD) وصلت main؛ توزيعها على الزبائن يتطلب إصدار APK رسميًا
  (release workflow) — الـ artifact الجاهز من CI: `dzhoof-staging-production-apk`.
- PR #218 (v1.2.0 integration — Android channel-manage + player tracks) ما زال مفتوحًا؛
  يمكن دمجه الآن لأن main أخضر (كان الـ flake هو العائق).

---

## ✅ #218 (Android v1.2.0) — دمج + نشر (2026-09-09 ~15:40 UTC)

- حدّثت فرع `integration/v1.2.0-merge` مع main (دمج نظيف بلا تعارضات؛ بقيت overrides.qs
  من #218 — تحققت محليًا: `npm ci` + بوابة audit سليمان) ثم دمجته في main كـ **`9c0a0df`**.
- **main CI بعد الدمج: SUCCESS** (backend + android + frontend) عند 15:37 UTC.
- **النشر**: stage-release + `APPLY=1 atomic-deploy.sh 9c0a0df…` (السجل:
  `/var/log/dzhoot-deploy-r23-218.log`) — **DEPLOYED** بلا rollback.
- التحقق الحي: `/health` → commit `9c0a0df` (builtAt 15:38:05Z) · api/frontend/scheduler
  Up (healthy) · `alertingConfigured: True` · لوحة admin HTTP 200 · تايمر التنظيف active ·
  `RELEASE_COMMIT` في env صُحّح إلى 9c0a0df · القفل محرر.
- القرص 70% بعد نشرين اليوم (~2.1GB صور لكل نشر) — متوقع؛ التنظيف الأسبوعي يدير الصور،
  ويمكن إضافة تنظيف أدلة `/opt/dzhoot-releases` القديمة كتحسين لاحق.
- **محتوى v1.2.0 في main الآن**: إدارة قنوات (إخفاء/قفل لكل قناة)، تفضيلات مسارات
  (audio/subtitle) تُطبَّق تلقائيًا، مطابقة معدل إطارات العرض، شارة رقم القناة في zap bar،
  Room v11 — بانتظار إصدار APK رسمي لتوزيعها على الزبائن.

---

## ✅ إصدار APK v1.2.0 للزبائن (2026-09-09 ~21:20 UTC)

- **البناء**: على VPS (JDK 17 + Android SDK 34 + مفتاح الإنتاج `dzhoof-production.jks`) —
  `assembleOfficialRelease + testOfficialReleaseUnitTest -PversionName=1.2.0`
  (سكربت `build-v120.sh`، استئنف من الكاش بعد قطع ssh أول — **BUILD SUCCESSFUL**).
- **الاختبارات**: 522/522 (0 فشل/0 خطأ) — ارتفاعًا من 458 في v1.1.0.
- **الـ APK**: `app-official-release.apk` — 23,335,133 بايت — SHA-256
  `3bcf65f009fb63683469bb36afbc66ce839794655f7ca4cb10e5d3a087de8edf`.
- **التوقيع**: شهادة الإنتاج CN=DZ HOOF IPTV — SHA-256 `5938049a…` = **نفس مفتاح v1.1.0**
  (تحديث مباشر دون إعادة تثبيت). aapt: versionName 1.2.0 / versionCode 10200.
- **GitHub Release**: [v1.2.0](https://github.com/mostafabonnif-beep/dzhoot/releases/tag/v1.2.0)
  بالأصلين (APK + sha256).
- **MongoDB appversions**: صف 1.2.0 (10200) نشط + إلغاء تنشيط 1.1.0.
- **Redis**: كاش `ghrel:latest` مكسور.
- **تحقق حي**:
  - `/api/v1/app/version?currentVersion=10100` → `updateAvailable: true`, latest 1.2.0/10200, src db.
  - `/api/v1/app/latest` → 1.2.0/10200 (23,335,133 بايت).
  - `/api/v1/app/download` → HTTP 200 نهائي، الحجم 23,335,133، **SHA-256 مطابق تمامًا** للـ APK الموقّع.
- **مسار الإصدار**: CI-workflow للـ release لا يعمل (غياب سرّ GOOGLE_SERVICES_JSON_BASE64) —
  الإصدار الرسمي يُبنى على VPS (نفس مسار v1.1.0). الإصدارات السابقة (حتى 1.1.0) لا تتضمن
  google-services.json — للتفعيل مستقبلًا يلزم توفير الملف من المالك (Firebase/FCM).
