# DZ HOOF — Subscription & Activation System

نظام الاشتراكات وأكواد التفعيل (القلب التجاري للمنصة).
أُضيف على الـBackend الحالي (Express + MongoDB) في 2026-08-10.

## الموديلات الجديدة (`src/models/`)

| الموديل | الوصف |
|---|---|
| `Plan` | باقة اشتراك: الاسم، المدة بالأيام، عدد الأجهزة، السعر، العملة، الحالة (Active/Inactive) |
| `ActivationCode` | كود تفعيل: **يُخزن كـ SHA-256 hash فقط** + آخر 4 أحرف للعرض/البحث، الحالة (UNUSED/ACTIVATED/REVOKED/EXPIRED)، تاريخ انتهاء اختياري للكود نفسه |
| `ActivationRedemption` | سجل كل محاولة تفعيل (نجاح/فشل + سبب + hash الـIP) — للأمان والتحقيق |
| `Subscription` | اشتراك المستخدم (ACTIVE/EXPIRED/CANCELLED) مع بداية/نهاية |
| `Device` | أجهزة المستخدم المسجلة (حد فريد على userId+deviceId) |

## API الجديدة

### إدارة (أدمن فقط — جلسة + دور Admin)

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/v1/admin/plans` | قائمة الباقات مع عدد الأكواد والاشتراكات |
| POST | `/api/v1/admin/plans` | إنشاء باقة |
| PATCH | `/api/v1/admin/plans/:id` | تعديل باقة |
| DELETE | `/api/v1/admin/plans/:id` | حذف (إن لم تكن لها أكواد) أو تعطيل |
| GET | `/api/v1/admin/activation-codes` | قائمة الأكواد (فلترة: planId, status, search بالـ last4، ترقيم صفحات) |
| GET | `/api/v1/admin/activation-codes/stats` | إحصائيات الأكواد حسب الحالة والباقة |
| POST | `/api/v1/admin/activation-codes/generate` | توليد دفعة أكواد (1..10000) — **النص الصريح يُعرض مرة واحدة** |
| GET | `/api/v1/admin/activation-codes/:id` | تفاصيل كود |
| POST | `/api/v1/admin/activation-codes/:id/revoke` | إلغاء كود غير مفعّل |

### المستخدم (جلسة أو JWT)

| الطريقة | المسار | الوصف |
|---|---|---|
| POST | `/api/v1/activation/redeem` | تفعيل كود — ينشئ الاشتراك أو **يمدد** الموجود |
| GET | `/api/v1/me/subscription` | الاشتراك الحالي + الباقة + الأجهزة (المستخدمة/الحد) |
| GET | `/api/v1/me/devices` | الأجهزة المسجلة |
| POST | `/api/v1/me/devices` | تسجيل جهاز (يفرض حد الباقة) |
| DELETE | `/api/v1/me/devices/:deviceId` | حذف جهاز (يحرر خانة) |

## منطق التفعيل (`src/services/subscription-service.ts`)

ترتيب التحقق كما في مواصفة DZ HOOF:
`كود موجود؟ → غير مستخدم؟ → الباقة فعّالة؟ → المستخدم صالح؟ → الجهاز مسموح؟ → إنشاء/تمديد الاشتراك → تعليم الكود مفعّلًا`

- **المدة تبدأ عند التفعيل** وليس عند الإنشاء.
- تفعيل كود جديد قبل انتهاء الاشتراك **يمدد** `expiresAt` بدل إنشاء صف متعارض.
- الأكواد تُخزن مجزّأة (hash) — تسريب قاعدة البيانات لا يولّد أكوادًا قابلة للاستخدام.
- حد الأجهزة يُفرض عند التسجيل وعند التفعيل إذا أُرسل `deviceId`.

## الاختبارات والتحقق

- `npx jest` — 106 اختبارات ناجحة (منها 17 جديدة للنظام التجاري).
- `npx tsx scripts/smoke-activation.ts` — اختبار دخان يشغّل الخادم الحقيقي + MongoDB مؤقت ويمرّ بالدورة كاملة (دخول الأدمن ← باقة ← أكواد ← تسجيل مستخدم ← تفعيل ← تمديد ← أجهزة ← إلغاء).

## لوحة التحكم (Next.js)

- `/admin/plans` — إدارة الباقات.
- `/admin/codes` — توليد الأكواد (مع تنزيل CSV + نسخ) والفلترة والإلغاء.
- `/user/subscription` — تفعيل كود + عرض الاشتراك والأجهزة.

## التالي (Sprints قادمة)

1. شاشة التفعيل في تطبيق Android + ربط حد الأجهزة عند التشغيل.
2. طبقة `POST /streams/authorize` (حماية روابط البث).
3. Movies/Series + بحث موحّد.
4. إشعارات FCM + 2FA للمشرف.

---

## إضافات 2026-08-10 (الجولة الثانية — إكمال النواقص)

### استيراد Xtream Codes (`/api/v1/admin/xtream-sources`)
- إضافة مصدر: `{ serverUrl, username, password }` — **البيانات مشفّرة AES-256-GCM** عند التخزين.
- `POST /:id/test` — تحقق من الاعتماد (`player_api.php` → `user_info.auth == 1`).
- `POST /:id/sync` — مزامنة كاملة: Live → قنوات الكتالوج، VOD → أفلام، Series → مسلسلات + مواسم + حلقات (مع حد تزامن للحلقات).
- **Prune**: المحتوى الذي اختفى من البانل يُعطَّل تلقائيًا.
- الأخطاء الجوهرية (فشل قوائم البث) تسجّل `syncStatus = error` — لا "نجاح" وهمي.

### VOD / الكتالوج (`/api/v1/catalog`)
- موديلات: `Movie`, `Series`, `Season`, `Episode` (فهارس فريدة sourceId+externalId).
- مسارات: movies (+categories)، series (+categories)، series/:id/seasons، seasons/:id/episodes.
- `GET /catalog/search?q=` — بحث موحّد (قنوات + أفلام + مسلسلات).
- التصفح عام (auth اختياري)؛ حماية البث عبر `/streams/authorize`.

### حماية البث (`/api/v1/streams/authorize`)
- `POST { contentType: LIVE|MOVIE|EPISODE, contentId }` → يفحص: مستخدم ← اشتراك ← محتوى ← رابط.
- عندما يكون إعداد `subscription_required` مفعّلًا (لوحة الأدمن)، المستخدم بلا اشتراك نشط يرفض بـ `403 SUBSCRIPTION_EXPIRED` — الأدمن يتجاوز.
- الإعداد عبر `PUT /api/v1/admin/app-settings` `{ subscription_required: true }`.

### Home ديناميكي (`GET /api/v1/home`)
- أقسام: Featured (قنوات/أفلام/مسلسلات يحددها الأدمن عبر إعداد `home`) + Latest.
- الإعداد: `PUT /api/v1/admin/app-settings { home: { featuredChannelIds: [], featuredMovieIds: [], featuredSeriesIds: [] } }`.

### إشعارات
- أدمن: `GET/POST /api/v1/admin/notifications` + `POST /:id/send` (FCM يُربط لاحقًا).
- مستخدم: `GET /api/v1/me/notifications` (مع حالة القراءة) + `POST /me/notifications/:id/read`.

### CI
- `.github/workflows/ci.yml` على **جذر المستودع** (كانت workflows مدفونة داخل server/ ولا تشتغل): typecheck + lint + 114 اختبارًا + بناء الواجهة، تلقائيًا مع كل push/PR.

### Android (تمت كتابته — البناء على جهازك)
- **إكمال إعادة التسمية**: كل الملفات انتقلت إلى `com.dzhoof.iptv` (277 ملف، صفر مراجع `cadnative`)، والحزمة `applicationId = com.dzhoof.iptv` أصبحت متطابقة.
- **قسم Subscription** في الإعدادات: تفعيل كود + عرض الباقة/الانتهاء/الأجهزة + إزالة جهاز (DTOs + API + Repository + ViewModel + Hilt).
