# 💡 فكرة: «مصدر احتياطي تلقائي — صفر انقطاعات عند كثرة المشاهدين»
**تقرير تسليم الفكرة للتنفيذ — 2026-08-25**
> اقرأ هذا أولًا إذا كنت «لبعدك». هذه فكرة مُختبرة (feasibility جاهزة) بانتظار التنفيذ.
> البنية الحالية للمصادر المتعددة موجودة أصلًا — المشروع نصف منجز في القاعدة والشيفرة.

---

## 1. الفكرة باختصار

عند سقوط المزود الأساسي (**Business Cloud NEO**) تنقطع كل القنوات لأنها كلها من مصدر واحد.
الحل: **مصدر ثانٍ (panel Xtream اسمه ottstreambox — كتالوج مغاربي ضخم) + تبديل تلقائي على مستوى الخادم**
بين المزودين وقت إصدار توكين البث، **بدون أي تحديث للتطبيق** وبدون شعور الزبون (سبينر 2–5 ثوانٍ فقط).

## 2. النتائج المُثبتة بالاختبار الحي (2026-08-25 — لا تكرر الاختبار)

| الفحص | النتيجة |
|---|---|
| الكتالوج | **115,448 قناة** — تغطية جزائرية/مغاربية ممتازة بجودات متعددة (ENTV1 SD/HD/FHD…) |
| الصيغة | `output=m3u8` يشتغل → HLS عادي. **استخدم m3u8، وليس mpegts** (ملف الـ m3u اللي وصلك بـ output=mpegts؛ غيّره إلى m3u8) |
| panel | `player_api.php` يشتغل → **XtreamSource كامل** (أفضل من استيراد m3u خام) — فئات `~ ALGERIE ~ / ~ MAROC ~ / ~ TUNISIE ~` |
| الاشتراك | ساري حتى **~2027** (exp_date 1813351195) — ليس تجريبيًا |
| البث الحي | `.m3u8` → **302** إلى CDN برابط موقّع (`http://89.163.146.42:80/hls/<token>/<id>_<seq>.ts`) — شريحة رجعت `video/mp2t` سليمة (0x47) |
| حد الاتصالات | `max_connections=1` لكن **3 جلبان متوازية كلها 200** → الروابط الموقعة تتجاوز الحد (نفس سلوك NEO المُثبت سابقًا) → المباشر لا يختنق عند failover جماعي |
| VOD | موجود (أفلام عربية 2025/2026) — مكافأة مستقبلية فقط |
| **Catch-up** | ❌ **لا يوجد** (`get_short_epg` فارغ) → **لا تحوّل الـ catch-up/التسجيلات لهذا المصدر** — يبقى على NEO |

**خلاصة القرار**: NEO يبقى الأساسي (فيه catch-up)، ottstreambox = الاحتياط للبث المباشر فقط.

## 3. أين الاعتماديات؟ (أمان — لا تضعها في repo عام!)

- الاعتماديات (username/password) خاصة بـ ottstreambox — **سلّمها المستخدم في المحادثة بتاريخ 2026-08-25**.
- القاعدة: **لا تكتبها في أي ملف داخل الـ repo** (الـ repo عام القراءة). 
- إن لم تجدها في سياقك: **اطلبها من المستخدم مجددًا** (هو من يملكها).
- خزّنها **مشفرة** في قاعدة البيانات بنفس نمط NEO:
  `encryptSecret()` من `server/backend/src/utils/crypto.ts` (AES-256-GCM، المفتاح من `XTREAM_SECRET_KEY` في `/etc/dzhoot/.env.production`).
- الـ serverUrl لا يحتوي اعتماديات: `http://ottstreambox.xyz:80`

## 4. البنية الحالية — كل ما تحتاجه موجود

| المكوّن | الملف | الحالة |
|---|---|---|
| نموذج المصدر | `backend/src/models/XtreamSource.ts` | جاهز (`status`, `verificationStatus`, `directPlayback`, `lastDiagnostics`, `stats`) |
| إدارة مصادر Xtream (API) | `backend/src/routes/admin-xtream-sources.js` | جاهز: POST / , /:id/test, /:id/diagnostics, /:id/import-catalog, PATCH /:id |
| استيراد m3u | `backend/src/services/m3u-service.ts` + `admin-m3u-sources.js` | جاهز (يوجد أصلًا 7 قنوات m3u في القاعدة) |
| **مطابقة القنوات** | `backend/src/services/channel-identity-service.ts` | جاهز — استخدمه للمطابقة (اسم/شعار/EPG id) |
| **المجدول الدوري** | `backend/src/services/scheduler-service.ts` + `task-registry.ts` | جاهز — الـ watchdog يُضاف كـ task هنا |
| إصدار التوكين/الاختيار | `backend/src/routes/tv.js` (authorize + playback-token) | جاهز — نقطة التبديل |
| الإشعارات (webhook) | `backend/src/services/alert-notifier.ts` | جاهز |
| كاش | `backend/src/services/cache.ts` / `external-source-cache.ts` | جاهز — خزّن حالة المصدر النشط |

## 5. خطة التنفيذ خطوة بخطوة

### المرحلة 1 — إضافة المصدر (صفر تأثير على الشغال)
1. إضافة `XtreamSource`:
   - `name: "Backup Maghreb (ottstreambox)"`، `serverUrl: http://ottstreambox.xyz:80`
   - `usernameEncrypted/passwordEncrypted` عبر `encryptSecret` (نفّذها داخل حاوية `dzhoof-api` بـ node -e، مثل طريقة فحص NEO سابقًا)
   - **`status: "Inactive"`** ← المفتاح: لا تغيير على البث الحالي أثناء الإعداد
   - `verificationStatus: "pending"`، `directPlayback: true`، `customerVisible: false`
2. الطرق: (أ) API: `POST /admin/xtream-sources` بجلسة أدمن، أو (ب) mongosh + encryptSecret.
3. تحقق: `POST /:id/test` ثم `/diagnostics` — توقع `verified`.

### المرحلة 2 — المطابقة (channel mapping)
1. استيراد كتالوج المصدر (لوحة/API) **لكن** لا تعرض كل 115k للزبون:
   - استخدم `channel-identity-service` لمطابقة القنوات مع كتالوج NEO الحالي (16,640 قناة).
   - أولوية: القنوات الجزائرية + العربية + الرياضية الموجودة عندنا.
2. خزّن المطابقة: **collection جديدة `channelfailovermaps`**:
   `{ neoChannelId, backupChannelId, backupStreamId, backupUrl, matchedBy, enabled }`
   (أو حقول على channel — الاختيار لك، لكن collection منفصلة أنظف).
3. لا تمسّ قنوات NEO الحالية — مجرد خريطة جانبية.

### المرحلة 3 — الـ Watchdog + التبديل التلقائي (قلب الفكرة)
1. **task جديد في `task-registry.ts`** (يعمل كل 60 ثانية):
   - لكل مصدر `directPlayback:true`: probe player_api أو قناة معروفة بمهلة قصيرة (5s).
   - حدّث `verificationStatus` (verified/degraded/blocked) + `lastError` + `lastDiagnostics`.
2. **قرار المصدر النشط** في tv.js (authorize + playback-token):
   - حالة المصدر تُقرأ من كاش (مثل `external-source-cache`) — لا query على كل طلب.
   - المنطق: `sourceActive(source)` = verified ولم يحن `degradedAt`… 
     - NEO `verified` → كل شيء كالعادة.
     - NEO `degraded/blocked` → القنوات التي **لها mapping** تصدر توكين من ottstreambox (نفس آلية directPlayback — يخرج رابط مباشر موقّع من المصدر الاحتياطي).
     - لا mapping؟ → تبقى على NEO (لا تزيد الضغط على الاحتياطي).
3. **العودة تدريجيًا**: عند عودة NEO لـ verified، الجلسات النشطة تكمل، **الجلسات الجديدة فقط** ترجع لـ NEO (منع الـ flapping).
4. **التبديل اليدوي**: `PATCH /admin/xtream-sources/:id` (status/override) — موجود أصلًا.

### المرحلة 4 — شاشة حالة في لوحة الأدمن (اختياري لاحقًا)
- قسم «حالة المصادر»: verificationStatus + آخر فحص + lastError لكل مصدر + زر تبديل يدوي.

## 6. الاختبار (قبل النشر)

1. **Unit**: منطق `sourceActive` + اختيار المصدر في tv.js (mock الحالات الثلاث).
2. **Integration**: task الـ watchdog يحدّث الحالة عند استجابة/فشل mock.
3. **حي (ليلي)**: 
   - عطّل NEO مؤقتًا (`status: Inactive` في mongosh) → افتح قناة عليها mapping في التطبيق → يجب أن تشتغل من ottstreambox (تحقق من host الشريحة) → أرجع NEO → تأكد أن الجلسة الجديدة ترجع له.
   - تحقق **عدم** الـ flapping: 5 ثوانٍ بين الحالتين.
4. الاختبارات الحالية: `npm test` في backend (272+ اختبار) + `npx tsc --noEmit` + eslint — كلها خضراء قبل النشر.

## 7. النشر (الروتين المعتاد)

```bash
# 1) commit + push (لا تضع الاعتماديات!)
cd /home/user/.workspace/dzhoot && git add -A && git commit -m "feat: backup source auto-failover" && git push origin main
# 2) حزمة + VPS
tar --exclude='node_modules' --exclude='.next' --exclude='coverage' --exclude='preview' -czf ../dzhoot-deploy/dzhoot-round17.tar.gz server/
scp -i dzhoot/dzhoof-admin-key dzhoot-deploy/dzhoot-round17.tar.gz dzhoof-admin@5.135.79.221:/tmp/
ssh -i dzhoot/dzhoof-admin-key dzhoof-admin@5.135.79.221 'sudo tar -xzf /tmp/dzhoot-round17.tar.gz -C /opt/dzhoot --overwrite && sudo chown -R root:root /opt/dzhoot/server'
ssh -i dzhoot/dzhoof-admin-key dzhoof-admin@5.135.79.221 'cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply'  # ~10 دقائق
```

## 8. مزالق (تجنّبها)

1. **لا تضع الاعتماديات في الـ repo** (عام القراءة). اطلبها من المستخدم إذا لم تكن في سياقك.
2. **لا تستورد 115k قناة كما هي** — تكرار هائل؛ استورد عبر المطابقة أو فلتر الفئات المغاربية أولًا.
3. **استخدم `output=m3u8`** لا mpegts — يمر بسلاسة في مسار HLS الحالي (بروكسي/كاش مستقبلي).
4. **لا تحوّل catch-up لـ ottstreambox** — لا يدعمه (NEO يبقى وحيدًا له).
5. **max_connections=1 لا يمنع الروابط الموقعة** (مثبت) — لكن لا تعتمد على مزامنة/EPG كثيفة منه.
6. **راقب exp_date** (حتى 2027) — أضف تنبيه قبل انتهاء أي مصدر.
7. التطبيق القديم (قبل 1.0.2) بلا إعادة محاولة تلقائية — التبديل يخدمهم عند فتح قناة جديدة فقط.
8. لا تجعل الـ watchdog يفحص بتردد أقل من 30 ثانية (ضغط على المزودين + قد يسبب حظر).

## 9. المكاسب المتوقعة بعد التنفيذ

- NEO وقع → القنوات المطابقة تشتغل من ottstreambox خلال ثوانٍ (الزبون لا يدرك).
- سعة مشاهدين أكبر: المباشر من كلا المزودين بروابط موقعة (بلا حد اتصالات).
- كتالوج مزدوج للمساومة مستقبلًا (مزود ثالث/رابع بنفس الآلية).
- VOD عربي إضافي (مرحلة لاحقة اختيارية).

---
**حالة المشروع العامة (مرجع سريع)**: main = `974f9df` = الخادم (10/10 sha256) — deploy r16 `v1.0.1-20260825T074000Z` — التحديث الداخلي 1.0.10 حي — التفاصيل الكاملة في `HANDOVER_REPORT_2026-08-25_ROUND16_FINAL_AR.md`.
