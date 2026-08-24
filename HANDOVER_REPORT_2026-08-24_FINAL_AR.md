# تقرير التسليم النهائي — DZ HOOF IPTV (جلسة 2026-08-24، جولات 7-9)

> **اقرأ هذا أولًا.** هذا هو التقرير الموحّد الوحيد الذي تحتاجه لبدء العمل: الوصول، كل ما أُنجز في هذه الجلسة (الجولات 7 و8 و9)، حالة الإنتاج، ما تبقى، والأوامر السريعة. المراجع التفصيلية: `ADMIN_IMPROVEMENT_REPORT_ROUND7/8/9_AR.md` + `HANDOVER_REPORT_2026-08-24_AR.md` (جلسة سابقة) + `PROJECT_STATE_HANDBOOK_AR.md`.

---

## 1. الملخص التنفيذي

| الجبهة | النتيجة |
|---|---|
| **المستودع** | ✅ GitHub `main` = الخادم = `1bfdb4f` — 17 ملفًا متحققًا بالـ checksums |
| **لوحة التحكم** | ✅ قسم "نظرة الأعمال" + عمود/سجل الرصيد + استرجاع الأكواد |
| **منظومة الموزعين** | ✅ رصيد → توليد ذاتي ببادئة المحل → تفعيل → احتساب الأيام (كل الحلقة مكتملة ومرئية) |
| **الإنتاج** | ✅ `v1.0.1-20260824T153300Z` — 6 حاويات healthy، Health OK |
| **CI** | ✅ أخضر على commits الكود (`72347ce`، `31be3b0`) |
| **اختبارات** | ✅ 250/250 + tsc + eslint نظيفة |

---

## 2. الوصول (ثابت)

- **SSH**: `dzhoof-admin@5.135.79.221` بمفتاح `/home/user/.ssh/dzhoof_id` (تعليق المفتاح `dzhoof-admin@vps`). sudo كاملة بلا كلمة مرور.
- **GitHub**: `mostafabonnif-beep/dzhoot` — التوكن `/etc/dzhoot/github.token` على الخادم (PAT 40 حرفًا). الدفع: `git push https://x-access-token:$TOKEN@github.com/mostafabonnif-beep/dzhoot.git main`.
- **الإنتاج**: `/opt/dzhoot/server` (نسخة ملفات، **ليست git**) + `/etc/dzhoot/.env.production` (chmod 600).
- **لوحة التحكم**: `https://iptv.ld-11.net/admin` — `admin` / `DZHOOF-b358a74599573e6e84ae7bcf18ab37da`. ⚠️ **كلمات المرور مكشوفة في محادثة — غيّرها (أولوية أمنية)**.
- **قاعدة البيانات**: MongoDB في الحاوية `dzhoof-mongodb` — **قاعدة الإنتاج اسمها `dzhoof-iptv`** (ليست `test`!). انظر الدرس في القسم 7.

## 3. ما أُنجز في هذه الجلسة (جولات 7-9)

### الجولة 7 — مزامنة + نظرة الأعمال
- رفع ميزة "رصيد المحلات" التي كانت على الخادم فقط إلى GitHub (Reseller.credit، بوابة الموزع، التوليد الذاتي) + إصلاح نقص استيراد `Reseller` (كان سيعيد 500).
- **قسم "نظرة الأعمال"** في لوحة القيادة: `GET /admin/business/summary` — تفعيلات، إيراد (من أسعار الخطط)، اشتراكات، رصيد المحلات، آخر التفعيلات بأكواد مقنّعة.
- عمود الرصيد في قائمة المحلات.

### الجولة 8 — سجل الرصيد + استرجاع + انتهاء صلاحية + استقلالية الموزع
- **`CreditTransaction`** (سجل حركات: GRANT/CONSUME/RETURN/EXPIRE_RETURN + balanceAfter) — ظاهر للأدمن (زر سجل الرصيد) وللموزع.
- **استرجاع يدوي**: زر يلغي الأكواد غير المستخدمة ويعيد الرصيد.
- **انتهاء صلاحية**: أكواد الموزع تنتهي خلال `code_expiry_days` (AppSetting، افتراضي 30) + مهمة مجدولة `code-expiry-check` تعيد الرصيد تلقائيًا.
- **بوابة الموزع**: تغيير كلمة المرور ذاتيًا + أسعار الجملة.

### الجولة 9 — إكمال فكرة الموزع (طلب المستخدم الأخير)
- **بادئة أكواد فريدة لكل محل** (`Reseller.prefix` 3-6 أحرف) — كل كود يحمل بادئة محله.
- **محاسبة المشتريات**: `unitPrice` + `amount` (كمية × سعر الجملة) في حركات المنح؛ الموزع يرى "حسابي" (مُشترى/قيمة/مُستهلك/صافي).
- **نوافذ الاشتراك**: الكود المُفعَّل يعرض بداية ونهاية الاشتراك (عبر `ActivationRedemption → Subscription`) — الأيام تُحسب من التفعيل ويراها الموزع.
- **تنبيه انتهاء قريب** (7 أيام) في البوابة.

## 4. حالة الإنتاج (مُتحققة 2026-08-24)

- 16,640 قناة | 7 مستخدمين | 6 اشتراكات نشطة | 2 محل (محل بن عكنون ×2، رصيد 0، بلا بادئة بعد) | EPG ~1184 قناة.
- 6 حاويات healthy (api/frontend/scheduler/caddy/redis/mongodb) | نسخة mongodump قبل كل نشر | آخر نشر `v1.0.1-20260824T153300Z`.
- القاعدة نظيفة: **0 حركة رصيد يتيمة**، لا بيانات اختبار متبقية.

## 5. ما تبقى (بالأولوية)

### 🔴 أمني (عاجل)
- [ ] **تغيير كلمة مرور root** للخادم + **كلمة مرور admin** للوحة (مكشوفتان في المحادثة)
- [ ] مراجعة `github.token`

### 🔴 تجاري (للبيع الفعلي)
- [ ] **ضبط أسعار الخطط** (صفحة الباقات — كلها 0) → الإيراد وقيمة المشتريات تظهر فورًا
- [ ] **بوابة دفع** (CinetPay/Paymee/Stripe)
- [ ] **حد الأجهزة عند التشغيل** (كود واحد ≠ أجهزة كثيرة)
- [ ] تعيين بادئات للمحلين الحقيقيين + ضبط `code_expiry_days` حسب سياسة البيع

### 🟡 EPG
- [ ] مصدر عربي/جزائري شامل (أكبر فجوة محتوى)
- [ ] beIN SPORTS 5 + MAX 1/2 | تعطيل الـ 13 مصدرًا الفاشل

### 🟡 كتالوج
- [ ] تنظيف: 16,635 قناة معطلة + أسماء متسخة (`## TR| …`, `NM:`) — الأدوات موجودة (bulk + purge)

### 🟢 تشغيلي
- [ ] **التنبيهات** (alertingConfigured: false رغم MAIL_PROVIDER=brevo + ALERT_WEBHOOK_URL)
- [ ] نسخ احتياطي خارجي (restic) + اختبار استعادة | R8 لتصغير APK

## 6. أوامر سريعة

```bash
ssh dzhoof                                    # الخادم
curl -s https://iptv.ld-11.net/health/ready   # صحة
# نشر: cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply
# اختبار محلي: cd server && npm ci && npm run build -w @dzhoof/shared && cd backend && npx jest
# واجهة: cd server/frontend && npx tsc --noEmit && npx eslint "src/app/**/*.tsx"
# مزامنة ملف: scp + sudo cp إلى /opt/dzhoot/server/... ثم نشر
# GitHub push: TOKEN=$(ssh dzhoof "sudo cat /etc/dzhoot/github.token"); git push https://x-access-token:$TOKEN@github.com/mostafabonnif-beep/dzhoot.git main
# مهام EPG: POST /api/v1/scheduler/trigger/epg-refresh (X-Session-Id admin)
# Mongo: sudo docker exec dzhoof-mongodb mongosh dzhoof-iptv   ← حدد القاعدة دائمًا!
```

## 7. دروس ومزالق (مهمة)

1. **mongosh داخل الحاوية يتصل بقاعدة `test` الافتراضية، وليست قاعدة الإنتاج `dzhoof-iptv`!** أي تنظيف مباشر: `mongosh dzhoof-iptv` أو `db.getSiblingDB('dzhoof-iptv')`. (في جولة 9 ظهرت "كل المحلات = 0" وكانت القاعدة الخطأ — بيانات الإنتاج سليمة.)
2. **كود الخادم غير المرفوع لم يمر على CI أبدًا** — عند المزامنة من الخادم شغّل الـ CI الكامل (lint + tests) قبل النشر (`reseller.js` كان سيعيد 500 بنقص استيراد).
3. نماذج Mongoose الجديدة: `module.exports = Model; export default Model;` (نمط Plan.ts).
4. مسارات `bulk` قبل `/:id` في أي راوتر جديد.
5. `PlaybackQualityData` مستوردة من `@/lib/api` — لا تعرّفها محليًا.
6. النشر يستغرق ~10 دقائق؛ لا تقاطعه، وانتظر `DEPLOY COMPLETE`.
7. IP بيئة الوكيل `136.118.71.205` قد يُحظر من fail2ban — فك الحظر: `fail2ban-client unban 136.118.71.205`.
