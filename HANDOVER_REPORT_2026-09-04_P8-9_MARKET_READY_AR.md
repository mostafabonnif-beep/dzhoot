# تقرير تسليم — DZ HOOF (2026-09-04: الأجزاء 5 و8 و9 — جاهزية السوق)

> **النطاق**: إكمال بقية أجزاء خطة العمل القابلة للتنفيذ دون مدخلات خارجية،
> ثم النشر على الإنتاج. الأجزاء 1–7 كانت منجزة سابقًا.

## 1) الجزء 5 — باقات Live/VOD (PR #180 — مدموج ✅)

- **النموذج**: `Plan.contentTypes: ['Live'|'VOD']` (افتراضي كلاهما) + ترحيل
  `0015-plan-content-types.ts` (قيم الباقات الحالية صارت صريحة).
- **البوابة**: `checkPlaybackSubscription(userId, role, contentType)` —
  القنوات = Live، الأفلام/المسلسلات = VOD. الباقة المحدودة لا تشغّل النوع الآخر
  (403 مع `PLAYBACK_CONTENT_BLOCKED`).
- **الواجهة**: صفحة إدارة الباقات — خيارا Live/VOD عند الإنشاء والتعديل +
  شارات في الجدول + تحقق (باقة واحدة على الأقل).
- **الاختبارات**: `plan-content-types.test.ts` 5/5 · المجموعة الكاملة 516/516 · CI أخضر.

## 2) الجزء 8 — بوابة الدفع CinetPay (ضمن PR #180 ✅)

- `cinetpay-service.ts`: checkout + فحص + تحقق توقيع HMAC SHA-256
  (`x-cinetpay-signature`) + تحقق مزدوج عبر `/v2/check` قبل الثقة بالـ webhook.
- مسارات: `/api/v1/payments/cinetpay/{config,checkout,status/:token,webhook}`
  بنفس عقد Chargily (publicToken للتصويت على صفحة النجاح، تفعيل كود فوري، تسجيل تدقيق).
- نموذج Payment: `provider: 'chargily' | 'cinetpay'` · العملة XOF.
- واجهة المتجر: زر الدفع يظهر تلقائيًا إذا كان أي مزوّد مفعّلًا؛ صفحة النجاح
  تسحب من `/api/v1/payments/status/:token` (عام للمزودين).
- **الاختبارات**: `payments-cinetpay.test.ts` 13/13 + chargily 46/46 إجمالًا.
- **للتفعيل**: حفظ `CINETPAY_API_KEY` و`CINETPAY_SITE_ID` في بيئة الخادم.

## 3) الجزء 9 — EPG: إعادة مطابقة دورية (PR #181 — مدموج ✅)

- مهمة مجدولة `epg-rematch` (كل 24 ساعة، افتراضيًا مفعّلة):
  `runEpgRematch()` تقرأ ids الأدلة الحالية من `EpgProgram` وتعيد مطابقة
  القنوات بلا tvgId عبر `epg-id-resolver` ثم `bulkWrite` ($set فقط للناقص،
  ولا يكتب id غير موجود في الأدلة). التغطية تتصاعد مع تحديث الأدلة تلقائيًا.
- **الاختبارات**: `epg-rematch-service.test.ts` 4/4.

## 4) الأمان (بدون تغييرات كود)

- **كلمة مرور admin (لوحة iptv.ld-11.net) دُوّرت**: القديمة المكشوفة أُبطلت،
  وTOTP (2FA) مفعّل. **الكلمة الجديدة أُرسلت عبر قناة آمنة — لا تُكتب في المستودع.**
- طلب تفعيل `workflow` scope على رمز GitHub (لتعديل ci.yml لاحقًا) — يحتاج
  موافقة تفاعلية من المالك.

## 5) النشر على الإنتاج (VPS 5.135.79.221) ✅

- `stage-release.sh 4693d55` ثم `atomic-deploy.sh` — نجح.
- **الإصدار النشط**: `4693d55ea9ef7c8d28ad4b1108aaf70be0573409` (main).
- الحاويات: api/frontend/scheduler `healthy`، mongodb/redis/caddy `up`.
- ترحيل 0015 مُطبّق (كل الباقات `contentTypes: ['Live','VOD']`).
- فحص دخان حي: `payments/{chargily,cinetpay}/config` → `{"enabled":false}`
  (سلوك صحيح — تنتظر المفاتيح) · `/admin` → 200.

## 6) ما تبقّى (يتطلب مدخلات من المالك فقط)

| البند | ما يلزم |
|---|---|
| تفعيل CinetPay | مفاتيح `CINETPAY_API_KEY` + `CINETPAY_SITE_ID` |
| تفعيل Chargily (إن رغبت) | `CHARGILY_*` في البيئة |
| النسخ البعيد (الجزء 10) | مزوّد تخزين B2/S3 |
| تعديل ci.yml (تسامح audit) | تفعيل workflow scope على توكن GitHub |
