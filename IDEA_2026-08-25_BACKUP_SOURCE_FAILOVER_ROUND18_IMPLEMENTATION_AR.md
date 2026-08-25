# تقرير تنفيذ — DZ HOOF IPTV (الجولة 18: «مصدر احتياطي تلقائي — صفر انقطاعات»)

**التاريخ:** 2026-08-25 (جولة 18)
**المصدر:** `IDEA_2026-08-25_BACKUP_SOURCE_FAILOVER_AR.md` (فكرة مُختبَرة الجدوى — سلّمها المستخدم)
**الحالة:** ✅ مُنفَّذ + مرفوع (`main` = `4fb796f`) + منشور `v1.0.1-20260825T153208Z` (محدث بعد ذلك)
**الآلية جاهزة لكنها خاملة حتى تُضاف اعتماديات المصدر الاحتياطي (ottstreambox) — يطلبها من المستخدم.**

---

## 1) ما بُني

| المكوّن | الملف | الوظيفة |
|---|---|---|
| **نموذج الخريطة** | `backend/src/models/ChannelFailoverMap.ts` | خريطة جانبية: قناة كتالوج ← قناة في المصدر الاحتياطي (`channelRef`+`backupSourceId` فريد، `enabled`) — لا تمسّ قنوات Upstream أصلًا |
| **خدمة التبديل** | `backend/src/services/source-failover-service.ts` | كاش صحة المصادر (TTL 60s) + `isSourceDown` + `getFailoverTarget` (احتياطي مُتحقق فقط) + **watchdog** (فحص API كل 60s + فحص بث حي كل 5 دقائق عبر قناة مطابَقة) + تنبيهات انتقال الحالة + `autoMatchFailoverMaps` (مطابقة بالاسم المُطبّع) |
| **المهمة الدورية** | `backend/src/services/task-registry.ts` | `source-watchdog` كل 60 ثانية (قابلة للضبط بـ SOURCE_WATCHDOG_INTERVAL_MS) |
| **نقطة التبديل** | `backend/src/routes/tv.js` | `/playback-token`: إذا الأساسي **متوقف فعليًا** (degraded/blocked) وموجود mapping → يُصدَر التوكين من الاحتياطي (نفس آلية direct + proxy، بنفس حصة الجلسة)؛ **الـ catch-up لا يُحوَّل أبدًا**؛ الرد يعلّم `source:'backup'` |
| **إدارة الخرائط** | `backend/src/routes/admin-xtream-sources.js` | `GET/POST /:id/failover-maps` + `DELETE /:id/failover-maps/:mapId` + `POST /:id/failover-maps/auto-match` + `GET /:id/health` + `POST /watchdog/run` |

## 2) قرارات التصميم (مهمة)

1. **التبديل فقط عند «متوقف صراحة»** (`degraded`/`blocked`) — لا عند pending/unknown —
   يمنع التذبذب بعد إقلاع الخادم قبل أول فحص.
2. **الاحتياطي يُضاف بـ `status: Inactive` + `directPlayback: true`** (كما تخطط الوثيقة:
   صفر تأثير على البث أثناء الإعداد) — قاعدة الأهلية في كل مكان = `Active` **أو** `directPlayback`
   (Upstream نفسه Inactive في القاعدة الآن بينما روابطه المباشرة تشتغل — اكتُشف أثناء الفحص الحي).
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
  خريطة → يبقى على Upstream.
- الكامل: باك-إند **298/298** (المجموع بعد الإصلاح) + tsc نظيف + eslint 0 أخطاء.

## 4) ما تبقى لتفعيل الميزة (يحتاجك)

1. **اعتماديات ottstreambox** (username/password) — منك مباشرة (لا تُكتب في repo عام).
2. أضيف المصدر عبر API اللوحة (أو mongosh + encryptSecret): `serverUrl: http://ottstreambox.xyz:80`،
   `status: Inactive`، `directPlayback: true`، `customerVisible: false` ← يظهر في
   «مصادر Xtream».
3. `POST /:id/failover-maps/auto-match` (فلتر `nameContains` للفئات المغاربية أولًا) أو إدخال يدوي.
4. **اختبار حي ليلي**: تعطيل Upstream مؤقتًا (mongosh) → فتح قناة مطابَقة → تشتغل من الاحتياطي
   (تحقق host الشريحة) → إرجاع Upstream → الجلسة الجديدة ترجع له.

## 5) ملاحظات

- Upstream حاليًا في القاعدة: `status: Inactive` + `verificationStatus: blocked` (خطأ TLS من
  الخادم إلى API Upstream — يبدو أن الخادم لا يصل لواجهة Upstream بينما روابطه المباشرة تعمل للزبائن؛
  هذا **لا يكسر شيئًا** لأن directPlayback يتجاوز الشرط). الـ watchdog سيظل يراقبه، وعند
  عودة الواجهة سيقلب الحالة تلقائيًا.
- النسخة السابقة من هذه الجولة نُشرت ثم اكتُشفت حالة الأهلية (Inactive+direct) أثناء الفحص
  الحي → أُصلحت وأُعيد نشرها (4fb796f).
