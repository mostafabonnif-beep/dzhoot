# تقرير تنفيذ — DZ HOOF IPTV (الجولة 18: «مصدر احتياطي تلقائي — صفر انقطاعات»)

**التاريخ:** 2026-08-25 (جولة 18)
**المصدر:** `IDEA_2026-08-25_BACKUP_SOURCE_FAILOVER_AR.md` (فكرة مُختبَرة الجدوى — سلّمها المستخدم)
**الحالة:** ✅ **مُفعَّلة ومنشورة ومُختبَرة حيًا بالكامل** — `main` = `d7bee3f`، نشر `v1.0.1-20260825T165444Z`

---

## 1) ما بُني

| المكوّن | الملف | الوظيفة |
|---|---|---|
| **نموذج الخريطة** | `backend/src/models/ChannelFailoverMap.ts` | خريطة جانبية: قناة كتالوج ← قناة في المصدر الاحتياطي (`channelRef`+`backupSourceId` فريد، `enabled`) — لا تمسّ قنوات NEO أصلًا |
| **خدمة التبديل** | `backend/src/services/source-failover-service.ts` | كاش صحة المصادر (TTL 60s) + `isSourceDown` + `getFailoverTarget` (احتياطي مُتحقق فقط) + **watchdog** (فحص API كل 60s + فحص بث حي كل 5 دقائق عبر قناة مطابَقة) + تنبيهات انتقال الحالة + `autoMatchFailoverMaps` (مطابقة بالاسم المُطبّع) |
| **المهمة الدورية** | `backend/src/services/task-registry.ts` | `source-watchdog` كل 60 ثانية (قابلة للضبط بـ SOURCE_WATCHDOG_INTERVAL_MS) |
| **نقطة التبديل** | `backend/src/routes/tv.js` | `/playback-token`: إذا الأساسي **متوقف فعليًا** (degraded/blocked) وموجود mapping → يُصدَر التوكين من الاحتياطي (نفس آلية direct + proxy، بنفس حصة الجلسة)؛ **الـ catch-up لا يُحوَّل أبدًا**؛ الرد يعلّم `source:'backup'` |
| **إدارة الخرائط** | `backend/src/routes/admin-xtream-sources.js` | `GET/POST /:id/failover-maps` + `DELETE /:id/failover-maps/:mapId` + `POST /:id/failover-maps/auto-match` + `GET /:id/health` + `POST /watchdog/run` |

## 2) قرارات التصميم (مهمة)

1. **التبديل فقط عند «متوقف صراحة»** (`degraded`/`blocked`) — لا عند pending/unknown —
   يمنع التذبذب بعد إقلاع الخادم قبل أول فحص.
2. **الاحتياطي يُضاف بـ `status: Inactive` + `directPlayback: true`** (كما تخطط الوثيقة:
   صفر تأثير على البث أثناء الإعداد) — قاعدة الأهلية في كل مكان = `Active` **أو** `directPlayback`
   (NEO نفسه Inactive في القاعدة الآن بينما روابطه المباشرة تشتغل — اكتُشف أثناء الفحص الحي).
3. **الرجوع تدريجيًا**: الجلسات الحية لا تُقطع؛ فقط طلبات التوكين الجديدة تعود للأساسي
   عند شفائه (لا flapping).
4. **لا mapping → لا تحويل** (لا زيادة ضغط على الاحتياطي).
5. الـ watchdog يفحص API كل 60s فقط، والبث الحي كل 5 دقائق وعبر قناة مطابَقة — ضغط
   ضئيل على المزودين (يُحترم تحذير الوثيقة: لا أقل من 30 ثانية).

## 3) الاختبارات (+14)

- `round18-failover-service.test.ts` (10): بناء URL، قراءة الصحة، رفض/قبول الأهلية
  (Inactive بدون direct مرفوض، Inactive+direct مقبول — حالة الإعداد المخطط)، تجاهل خريطة
  تشير للأساسي نفسه، watchdog: blocked عند فشل API، verified عند نجاحه، degraded عند فشل
  البث الحي، auto-match بالاسم مع تخطي غير الموجود.
- `round18-failover-tv.test.ts` (4): أساسي سليم → بلا تحويل؛ أساسي متوقف + خريطة →
  توكين من الاحتياطي مع `source:'backup'` + proxy مرافق؛ **catch-up لا يُحوَّل**؛ متوقف بلا
  خريطة → يبقى على NEO.
- الكامل: باك-إند **298/298** (المجموع بعد الإصلاح) + tsc نظيف + eslint 0 أخطاء.

## 4) ما تبقى لتفعيل الميزة (يحتاجك)

1. ~~**اعتماديات ottstreambox**~~ ✅ سلّمها المستخدم — المصدر أُضيف (`Backup Maghreb (ottstreambox)`،
   `serverUrl: http://ottstreambox.xyz:80`، اعتماديات مشفرة AES-256-GCM، `status: Inactive` +
   `directPlayback: true` + `customerVisible: false`) — **تحقق تلقائيًا** (`verified`).
2. ~~المطابقة~~ ✅ **263 خريطة تبديل** أُنشئت (auto-match بالقاموس + الضبابي، فئات
   ALGERIE/MAROC/TUNISIE/BEIN/ARABIC + حارس القنوات الأجنبية FI:/SE:/UK:/BR:/FR:...
   بعد اكتشاف خرائط خاطئة وحذفها — 10 خرائط حُذفت).
3. ~~الاختبار الحي~~ ✅ **اختبار E2E كامل ناجح (2026-08-25 ~17:00)**:
   - NEO سليم → توكين من **الأساسي** (source: primary).
   - حقن انقطاع (NEO → blocked في القاعدة) → توكين من **الاحتياطي** (`source: backup`،
     `failoverSourceId` = ottstreambox) — ومسار البث يرد 302 إلى
     `http://ottstreambox.xyz/live/.../60929.m3u8` — **بث حي يشتغل فعلاً**.
   - الـ watchdog (المجدول) **رجع NEO تلقائيًا** إلى verified خلال ~3 دقائق → التوكين الجديد
     عاد إلى **الأساسي** (لا flapping).

## 5) ملاحظات

- اكتشافات حية صحّحت التصميم أثناء التنفيذ:
  - **NEO API مسدود من الخادم (TLS) بينما CDN بثّه يعمل** → فحص الصحة للمصادر المباشرة
    يتم عبر **البث الفعلي** (قناة كتالوج أو بثّ مطابَق) لا عبر الـ API.
  - **ottstreambox manifests بروابط نسبية بعد 302** → فحص خفيف للمانيفست (200 + #EXTM3U)
    بدل الفحص العميق للمقاطع (الذي يفشل إيجابيًا كاذبًا).
- **جلسة موازية** دفعت ميزة «round-19» (معلومات الزبائن للموزعين) — دُمجت (`4488bc1` +
  `e2cac43`) ونُشرت مع جولة 18 في نفس النشر.
- دروس نشر: مزامنة tar تترك ملفات يتيمة كسرت docker build (`reseller-custom-codes.test.ts`
  القديم + `.bak`) — حُذفت، ووثّقت القاعدة (طابق قوائم الملفات بعد كل فك حزمة).
- NEO حاليًا `verified` (الواجهة قد تكون مسدودة من الخادم لكن البث يعمل — والقرار الصحيح
  للتبديل يعتمد على البث).
