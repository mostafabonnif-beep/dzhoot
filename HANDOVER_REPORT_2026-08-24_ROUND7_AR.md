# تقرير التسليم — DZ HOOF IPTV (جولة 7، 2026-08-24)

> **اقرأ هذا أولًا.** يلخّص هذا التقرير كل ما أُنجز في جلسة 2026-08-24 (الجولة 7) + حالة الإنتاج الحالية + كل ما تبقى، ليعرف أي وكيل/شخص قادم الوضع كاملًا من نقطة واحدة. المراجع الأقدم: `HANDOVER_REPORT_2026-08-24_AR.md` (جلسة 08-23/24) و`ADMIN_IMPROVEMENT_REPORT_ROUND7_AR.md` (تفاصيل الجولة) و`PROJECT_STATE_HANDBOOK_AR.md`.

---

## 1. الملخص التنفيذي

| الجبهة | النتيجة |
|---|---|
| **مزامنة المستودع** | ✅ الخادم كان متقدمًا على GitHub بميزة "رصيد المحلات" غير مرفوعة — رُفعت + تحقّق التطابق (GitHub `main` = الخادم = `0068e68`) |
| **لوحة التحكم** | ✅ قسم "نظرة الأعمال" في لوحة القيادة + عمود الرصيد في المحلات |
| **خطأ أمني/تشغيلي** | ✅ أصلحنا نقص استيراد `Reseller` في `reseller.js` (كان سيعيد 500) — كشفه الـ CI |
| **النشر** | ✅ `v1.0.1-20260824T135036Z` — كل الحاويات healthy |
| **CI على GitHub** | ✅ أخضر بالكامل (backend + frontend + android) |
| **التحقق الحي** | ✅ مسار المحل كامل (رصيد → توليد أكواد → خصم ذرّي) + لوحة القيادة + API الأعمال |

**الحالة**: المستودع = الخادم = 100% متطابقان (12 ملفًا متحققًا بالـ checksums). الإنتاج منشور وصحي.

---

## 2. الوصول والبنية (ثابتة)

- **SSH**: `dzhoof-admin@5.135.79.221` بمفتاح `/home/user/.ssh/dzhoof_id` (رفعه المستخدم؛ تعليقه `dzhoof-admin@vps`). صلاحيات sudo كاملة بدون كلمة مرور.
- **GitHub**: `mostafabonnif-beep/dzhoot` — التوكن على الخادم `/etc/dzhoot/github.token` (PAT 40 حرفًا، يعمل للـ push). الدفع عبر: `git push https://x-access-token:$TOKEN@github.com/... main`.
- **بيئة الإنتاج**: `/etc/dzhoot/.env.production` (chmod 600). المصدر: `/opt/dzhoot/server` (نسخة ملفات — **ليست git** — تُزامن يدويًا من المستودع). الحاويات: `dzhoof-api` + `dzhoof-frontend` + `dzhoof-scheduler` (نفس صورة API) + `caddy` + `redis` + `mongodb`.
- **النشر**: `cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply` (نسخة mongodump + بناء + ترقية + تحقق + سجل `/var/log/dzhoof-deploys.log`). يستغرق ~10 دقائق (بناء Next.js).
- **لوحة التحكم**: `https://iptv.ld-11.net/admin` — مستخدم `admin` / كلمة مرور `DZHOOF-b358a74599573e6e84ae7bcf18ab37da`. ⚠️ **كلمات المرور مكشوفة في المحادثة — يجب تغييرها (أولوية أمنية)**.

## 3. ما أُنجز في جولة 7

### أ) رفع ميزة "رصيد الأكواد" (كانت على الخادم فقط)
- `Reseller.ts`: `credit [{planId, quantity}]` + حقول بوابة (`username`, `passwordHash`, `lastLoginAt`).
- `admin-resellers.js`: منح/تعديل رصيد لكل محل حسب الخطة.
- `reseller.js`: `GET /credit` + `POST /codes/generate` (خصم ذرّي، سقف 50/عملية) + `GET /me` + `GET /batches(/:id/codes|/export)`.
- الواجهة: محرر رصيد في صفحة المحل + بوابة المحل (توليد ذاتي).
- **إصلاح جوهري**: `reseller.js` كان يستخدم `Reseller` بدون استيراده → `ReferenceError` عند أي استدعاء لـ /credit أو /codes/generate في الإنتاج. أُضيف الاستيراد (`0068e68`).

### ب) قسم "نظرة الأعمال" في لوحة القيادة (`/admin`)
- **Backend**: `GET /api/v1/admin/business/summary` — تفعيلات (شهر/إجمالي) حسب الخطة، إيراد = تفعيلات × سعر الخطة، اشتراكات نشطة، رصيد المحلات المتبقي، أكواد مولّدة الشهر، آخر 10 تفعيلات بأكواد **مقنّعة** (`DZ-••••-XXXX` — لا تسريب)، علم `pricesSet` لتنبيه الأسعار 0.
- **واجهة**: 4 بطاقات (تفعيلات الشهر، إيراد الشهر، اشتراكات نشطة، رصيد أكواد المحلات) + جدول آخر التفعيلات + تنبيه "الإيراد 0 حتى تُضبط الأسعار".

### ج) عمود "الرصيد" في قائمة المحلات
- يعرض رصيد كل محل حسب الخطة مباشرة في القائمة (بدل فتح كل محل).

### د) الاختبارات
- **الباكند: 33 مجموعة / 240 اختبارًا ناجحًا** (+2 جديدان: `admin-business-summary.test.ts`؛ +7 من الخادم: `reseller-credit.test.ts`). tsc نظيف.
- **الواجهة**: tsc نظيف + ESLint بلا أخطاء.
- **الـ CI أخضر على GitHub** (backend, frontend, android — آخر run على `0068e68`).

## 4. التحقق الحي (كلها ناجحة)

| الفحص | النتيجة |
|---|---|
| `/health/ready` | ✅ ok — mongodb/redis connected |
| `/admin` — قسم نظرة الأعمال | ✅ 4 بطاقات + جدول آخر التفعيلات + تنبيه الأسعار |
| `/admin/resellers` — عمود الرصيد | ✅ يظهر (فارغ "—" لأن لا رصيد ممنوح بعد) |
| `/api/v1/admin/business/summary` | ✅ 6 تفعيلات، 6 اشتراكات، 2 محل، 127 كودًا مولّدًا، pricesSet=false |
| **مسار المحل الكامل** (حساب مؤقت) | ✅ محل برصيد 5 → دخول → /credit=5 → توليد كودين → /credit=3 (الخصم الذرّي) → تنظيف كامل (لا بقايا) |

## 5. حالة الإنتاج الحالية (مُتحققة)

6 حاويات (api/frontend/scheduler/caddy/redis/mongodb) كلها healthy | آخر نشر `v1.0.1-20260824T135036Z` | 16,640 قناة | 7 مستخدمين | 6 اشتراكات نشطة | 2 محل (رصيد 0) | EPG ~1184 قناة | نسخ احتياطي mongodump قبل كل نشر.

## 6. ما تبقى (بالأولوية)

### 🔴 أمني (عاجل)
- [ ] **تغيير كلمة مرور root** للسيرفر (مكشوفة في المحادثة)
- [ ] **تغيير كلمة مرور admin** للوحة (مكشوفة في المحادثة)
- [ ] مراجعة `github.token` (إن أُرسل في محادثة)

### 🔴 تجاري (للبيع الفعلي)
- [ ] **ضبط أسعار الخطط** (صفحة الباقات — حاليًا كلها 0) → الإيراد يظهر فورًا في "نظرة الأعمال"
- [ ] **بوابة دفع** (CinetPay/Paymee/Stripe) — لا يوجد تحصيل
- [ ] **حد الأجهزة عند التشغيل** (كود واحد ≠ أجهزة كثيرة)

### 🟡 EPG
- [ ] مصدر عربي/جزائري شامل (أكبر فجوة محتوى — ملفات dz/ma/tn في iptv-epg.org 404)
- [ ] beIN SPORTS 5 + MAX 1/2 (لا مصدر حقيقي — تبقى "No Data")
- [ ] تعطيل الـ 13 مصدرًا الفاشل عبر `epgsourceoverrides`

### 🟡 كتالوج
- [ ] تنظيف: 16,635 قناة معطلة + أسماء متسخة (`## TR| …`, `NM:` مكررة) — الأدوات موجودة (bulk + purge في صفحة القنوات)

### 🟢 تشغيلي/تقني
- [ ] **التنبيهات** (alertingConfigured: false رغم MAIL_PROVIDER=brevo + ALERT_WEBHOOK_URL موجودين)
- [ ] **نسخ احتياطي خارجي** (restic غير مكتمل) + **اختبار استعادة**
- [ ] إعادة تفعيل R8 مع keep-rules (تصغير APK 77MB → ~30MB)
- [ ] ترقية Media3 1.5+ | رفع APK إلى GitHub Releases

## 7. أوامر سريعة

```bash
ssh dzhoof                          # السيرفر (dzhoof-admin@5.135.79.221)
curl -s https://iptv.ld-11.net/health/ready   # صحة
# نشر: cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply
# اختبار محلي: cd server && npm ci && npm run build -w @dzhoof/shared && cd backend && npx jest
# واجهة: cd server/frontend && npx tsc --noEmit && npx eslint "src/app/(dashboard)/admin/*/page.tsx"
# مزامنة ملف للخادم: scp + sudo cp إلى /opt/dzhoot/server/... ثم نشر
# GitHub push: TOKEN=$(ssh dzhoof "sudo cat /etc/dzhoot/github.token"); git push https://x-access-token:$TOKEN@github.com/mostafabonnif-beep/dzhoot.git main
# تحديث EPG: POST /api/v1/scheduler/trigger/epg-refresh (X-Session-Id admin)
```

## 8. دروس/مزالق يجب تذكرها

- **كود الخادم غير المرفوع لم يمر على CI أبدًا**: عند المزامنة من الخادم شغّل الـ CI الكامل (lint + tests) قبل النشر — مثال: `reseller.js` كان سيعيد 500 (نقص استيراد) ولم يظهر إلا في lint الـ CI.
- نماذج Mongoose الجديدة: `module.exports = Model; export default Model;` (نمط Plan.ts).
- مسارات `bulk` تُسجَّل قبل `/:id` في أي راوتر جديد.
- لا تعرّف `PlaybackQualityData` محليًا في لوحة القيادة (مستوردة من `@/lib/api`).
- IP بيئة الوكيل `136.118.71.205` قد يُحظر من fail2ban عند محاولات SSH خاطئة — فك الحظر: `fail2ban-client unban 136.118.71.205`.
- النشر يستغرق ~10 دقائق؛ لا تقاطعه، وتأكد من `DEPLOY COMPLETE` في النهاية.

---

## ⚡ تحديث — الجولة 8 (نفس اليوم): تحسين فكرة الرصيد والأكواد

نُفِّذت بعد تقرير الجولة 7 مباشرة (مطلوب المستخدم). التفاصيل الكاملة في `ADMIN_IMPROVEMENT_REPORT_ROUND8_AR.md`.

**أُضيف (4 تحسينات):**
1. **سجل حركات الرصيد** — نموذج `CreditTransaction` (GRANT/CONSUME/RETURN/EXPIRE_RETURN + balanceAfter). يُسجَّل تلقائيًا عند منح/تعديل الرصيد (بالفروقات) وعند كل توليد واسترجاع. زر "سجل الرصيد" لكل محل في اللوحة + قسم في بوابة الموزع.
2. **استرجاع الرصيد يدويًا** — زر "استرجاع الأكواد غير المستخدمة": يلغيها (REVOKED) ويعيد رصيدها فورًا (`POST /admin/resellers/:id/credit/return`).
3. **انتهاء صلاحية الأكواد + إعادة الرصيد تلقائيًا** — أكواد الموزع تنتهي خلال `code_expiry_days` (AppSetting، افتراضي 30)؛ مهمة مجدولة `code-expiry-check` (يوميًا) تعلّم المنتهية EXPIRED وتعيد الرصيد (EXPIRE_RETURN).
4. **بوابة الموزع** — تغيير كلمة المرور ذاتيًا (`POST /reseller/auth/change-password`) + عرض أسعار الجملة في `/reseller/me`.

**النشر:** `v1.0.1-20260824T143834Z` | GitHub `c2c1ddc` (كود) + `45f7169` (تقرير) | اختبارات 247/247 | تحقق حي كامل (منح→توليد→صلاحية→سجل→استرجاع→تنظيف ✓).

**تنبيه:** الأكواد القديمة غير المستخدمة (قبل الجولة 8، بلا `codeExpiresAt`) لن تنتهي تلقائيًا — تُدار بزر الاسترجاع اليدوي.

**ما تبقى (بعد الجولة 8):** نفس قائمة الجولة 7 + [ ] ضبط `code_expiry_days` في الإنتاج حسب سياسة البيع + [ ] إظهار تاريخ انتهاء الصلاحية في صفحة أكواد الأدمن (اختياري).
