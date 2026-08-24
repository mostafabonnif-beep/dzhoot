# تقرير التسليم — DZ HOOF IPTV (جلسة 2026-08-24، الجولة 13: الإتقان)

> **اقرأ هذا أولًا.** الوثيقة الوحيدة التي تحتاجها لبدء العمل: الوصول، كل ما أُنجز (الجولة 13 + فحص القنوات)، حالة الإنتاج، ما تبقى، الأوامر السريعة، والمزالق. التفاصيل: `ADMIN_IMPROVEMENT_REPORT_ROUND13_AR.md` (في الريبو وعلى الخادم) + التقارير السابقة `HANDOVER_REPORT_2026-08-24_FINAL_AR.md` + `PROJECT_STATE_HANDBOOK_AR.md`.

---

## 1. الملخص التنفيذي

| الجبهة | النتيجة |
|---|---|
| **المستودع** | ✅ GitHub `main` = `b024e55` = الخادم (12 ملفًا بالـ checksums) |
| **الإنتاج** | ✅ `v1.0.1-20260824T195220Z` — 6 حاويات healthy + لا OOM |
| **الجولة 13** | ✅ 4 أخطاء أُصلحت + ميزتان جديدتان (كلها مُتحقق حيًا) |
| **القنوات في التطبيق** | ✅ **~90% من عينة 30 قناة حية وتشتغل** (27 ALIVE / 2 DEAD / 1 EMPTY) — مصدر Xtream واحد (Business Cloud NEO) |
| **الاختبارات** | ✅ 253/253 باك-إند + 6/6 واجهة + tsc + eslint نظيفة |

---

## 2. الوصول (ثابت — لا يتغير)

- **SSH**: `dzhoof-admin@5.135.79.221` بمفتاح ed25519 (نسخة محفوظة في `/home/user/.workspace/dzhoot/dzhoof-admin-key`، التعليق `dzhoof-admin@vps`). sudo بلا كلمة مرور.
- **GitHub**: `mostafabonnif-beep/dzhoot` — التوكن `/etc/dzhoot/github.token` (PAT). الدفع:
  `git push https://x-access-token:$TOKEN@github.com/mostafabonnif-beep/dzhoot.git main`
- **الإنتاج**: `/opt/dzhoot/server` (نسخة ملفات، ليست git) + `/etc/dzhoot/.env.production` (chmod 600).
- **لوحة التحكم**: `https://iptv.ld-11.net/admin` — `admin` / `DZHOOF-b358a74599573e6e84ae7bcf18ab37da`. ⚠️ **كلمات المرور مكشوفة في محادثة المستخدم — غيّرها (أولوية أمنية قصوى).**
- **قاعدة البيانات**: حاوية `dzhoof-mongodb` — القاعدة **`dzhoof-iptv`** (وليس `test`!). دوامًا حدد القاعدة.

---

## 3. ما أُنجز في هذه الجلسة (الجولة 13)

### أ) إصلاحات مؤكدة (فحص حي + مراجعة كود)
1. **أسهم الترقيم معكوسة في RTL** — `frontend/src/components/ui/pagination.tsx`: السابق أصبح سهمًا يمينًا والتالي سهمًا يسارًا عندما تكون اللغة عربية. يلمس كل الصفحات المترقمة. (تحقق DOM: `prev=ChevronRight, next=ChevronLeft`).
2. **خطأ regex 2FA** — `frontend/src/app/(dashboard)/admin/settings/page.tsx` (سطران): `/\\D/g` → `/\D/g` (كان يطابق الحرفين `\D` حرفيًا ولا يمسح الحروف).
3. **إحصائيات الأجهزة من الصفحة فقط** — `backend/src/routes/admin.js` + `frontend/.../admin/devices/page.tsx`: الخادم يردّ الآن `stats { active7d, platforms, pendingPairings }` محسوبة على كامل المجموعة؛ أُضيف **بحث + فلترة حالة** (الكل/نشط/خامل) — الباك-إند كان يدعمها أصلًا.
4. **إشعار مجدول معروض كمسودة ولا يُرسل أبدًا** — `backend/src/routes/admin-notifications.js` (status=SCHEDULED عند وقت مستقبلي) + مهمة جديدة في `task-registry.ts` + واجهة الإشعارات.

### ب) ميزات جديدة
5. **جدولة الإشعارات**: حقل `datetime-local` في نموذج الإنشاء (زر يتبدل إلى "جدولة الإرسال") + شارة "مجدول" زرقاء مع وقت الجدولة + فلترة بالحالة + مهمة **`Scheduled Notification Dispatcher`** (كل 60 ثانية، `NOTIFICATION_DISPATCH_INTERVAL_MS` قابلة للضبط) تلتقط المستحقة وترسلها عبر FCM وتعلّمها SENT؛ الفشل النظامي يبقيها SCHEDULED لإعادة المحاولة. **ملاحظة**: FCM غير مهيأ حاليًا (لا مفاتيح) — المهمة تسجّل `configured: false` في سجل الجدولة.
6. **تعديل بيانات الأفلام/المسلسلات**: `backend/src/routes/admin-vod.js` — `PATCH /movies/:id` و`/series/:id` يقبلان حقول بيانات مُتحقق منها (عنوان، تصنيف، بوستر، خلفية، وصف/قصة، سنة، مدة، تقييم، فريق عمل...) مع بقاء تبديل `isActive` كما هو؛ الواجهة `vod-admin-shell.tsx` — زر "تعديل" في عرضي الشبكة والقائمة يفتح نافذة معبأة مسبقًا. (اختُبر نهاية-إلى-نهاية: حفظ في MongoDB ثم إرجاع القيمة الأصلية).
7. **بحث شامل ⌘K / Ctrl+K**: ملف جديد `frontend/src/components/global-search.tsx` + زر في الهيدر — يبحث بالتوازي في المستخدمين + الأكواد + القنوات، تنقل بلوحة المفاتيح، نتائج مجمعة، يعمل من أي صفحة.

### ج) فحص القنوات (طلب المستخدم: "القنوات فيها شغالة في التطبيق")
- **16,640 قناة، كلها `isActive: true`، كلها بروابط** من مصدر Xtream واحد: `Business Cloud NEO` (`cf.business-cloud-neo.ru`).
- **بروتوكول البث**: الرابط `https://cf.business-cloud-neo.ru/live/.../NNN.m3u8` يعيد **302** إلى نطاق edge موقّت (`*.ip1-neo62-htweerwerww.me:80/live/play/TOKEN/NNN`) ثم قائمة HLS حية.
- **عينة 30 قناة عشوائية (اختبار من الخادم بوكيل VLC)**: **27 حية (90%)** تحوي `#EXT-X-MEDIA-SEQUENCE` + **2 ميتة** ("Cannot read /home/nxt/storage/streams/NNNN_.m3u8" — القناة غير موجودة عند المزود) + **1 فارغة** (لا استجابة).
- **الخلاصة**: القنوات تشتغل في التطبيق فعلًا؛ ~7-10% ميتة بسبب المزود (طبيعي في IPTV أحادي المصدر). `flaggedBad` = 0 و`alternateStreams` = 0 — لا يوجد بدائل بعد.

---

## 4. حالة الإنتاج (مُتحققة 2026-08-24)

- 16,640 قناة نشطة (مصدر Xtream واحد) | 7 مستخدمين | 6 اشتراكات نشطة | محلاّن (بن عكنون) | ~66,896 فيلم VOD + مسلسلات.
- 6 حاويات healthy | آخر نشر `v1.0.1-20260824T195220Z` | نسخة mongodump قبل النشر في `/var/backups/dzhoot/mongodb/deploy-20260824T195220Z`.
- مهمة `notification-dispatcher` تعمل كل دقيقة (سجل الجدولة: مكتمل/3ms) | الإشعارات التجريبية حُذفت (القاعدة نظيفة).

---

## 5. ما تبقى (بالأولوية)

### 🔴 أمني (عاجل)
- [ ] **تغيير كلمة مرور root** + **كلمة مرور admin** (مكشوفتان في المحادثة) + مراجعة `github.token` و`JWT_ACCESS_SECRET`.

### 🔴 تفعيل التنبيهات والبريد (خطوات من اللوحة — الإعدادات جاهزة)
- [ ] رابط **webhook** حقيقي (Discord/Slack) + "تنبيه تجريبي".
- [ ] مفاتيح **Brevo SMTP** + بريد المُرسِل + "بريد تجريبي".
- [ ] مفاتيح **FCM** (لتفعيل الإشعارات — مهمة `notification-dispatcher` موجودة وتنتظرها فقط).

### 🔴 تجاري
- [ ] **بوابة دفع** (CinetPay/Paymee/Stripe) — الأكبر عائدًا.
- [ ] مراجعة الأسعار (شهري 500 / 6أشهر 2500 / سنوي 4500 دج).
- [ ] حد الأجهزة عند التشغيل + بادئات/رصيد حقيقي للمحلين.

### 🟡 جودة الكتالوج (ذات صلة بـ "القنوات في التطبيق")
- [ ] **تنظيف القنوات الميتة**: تشغيل Liveness Check على 16,640 قناة، ثم تعطيل/إزالة الميتة (~7-10% متوقعة ≈ 1,200-1,600 قناة) عبر أدوات bulk الموجودة في `/admin/channels` أو mongo.
- [ ] أسماء متسخة (`## TR|…`, `NM:`, `4K-AR: ...`) — البادئات تُكرر نفس القناة.
- [ ] **بدائل مصادر** (مصدر عربي/جزائري ثانٍ) — أكبر رافعة لصلابة البث.
- [ ] EPG عربي/جزائري شامل + beIN SPORTS 5/MAX.

### 🟢 تشغيلي
- [ ] نسخ احتياطي خارجي (restic) + اختبار استعادة | R8 لتصغير APK | ترقية Media3.

---

## 6. أوامر سريعة

```bash
ssh -i ~/.workspace/dzhoot/dzhoof-admin-key dzhoof-admin@5.135.79.221   # الخادم
curl -s https://iptv.ld-11.net/health/ready                              # صحة
curl -s "https://iptv.ld-11.net/health?details=true" | jq .details        # تفاصيل (alertingConfigured, sources…)
# نشر: cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply
# اختبار محلي: cd server && npm run typecheck && npm run test:backend && cd frontend && npx tsc --noEmit
# GitHub push: TOKEN=$(ssh dzhoof-admin@5.135.79.221 'sudo cat /etc/dzhoot/github.token')
#              git push https://x-access-token:$TOKEN@github.com/mostafabonnif-beep/dzhoot.git main
# Mongo: sudo docker exec dzhoof-mongodb mongosh dzhoof-iptv   ← حدد القاعدة دائمًا!
# فحص قناة: curl -sL --max-time 15 -A "VLC/3.0.20" <channelUrl> | head (يبحث عن #EXT-X-MEDIA-SEQUENCE)
```

---

## 7. دروس ومزالق (مهمة — أضيفت هذه الجلسة)

1. **مسارات فيها أقواس `(dashboard)` تكسر الاقتباس في الصدفة البعيدة** — عند التحقق من checksums على الخادم، اقتبس المسار كاملًا: `sudo sha256sum "/opt/dzhoot/server/frontend/src/app/(dashboard)/admin/.../page.tsx"`.
2. **`while read` + SSH في نفس الحلقة**: SSH يستهلك stdin فتنتهي الحلقة بعد أول سطر — استخدم `for` مع `< /dev/null` على أمر SSH.
3. **بنية Channel في mongo**: الحقل `channelUrl` (ليس `streamUrl`)، والمقاييس في `metrics` (aliveCount/deadCount...) و`flaggedBad`/`alternateStreams` — كلها 0 حاليًا لأن Liveness لم يُشغَّل بعد على الحجم الكامل.
4. **روابط المصدر تعيد 302** إلى نطاقات edge موقّتة — لا تحكم على قناة بـ HTTP code فقط؛ اتبع التوجيه (`-L`) وافحص نص `#EXT-X-MEDIA-SEQUENCE` (حية) مقابل `Cannot read /home/nxt/storage/streams/…` (ميتة).
5. **mongosh داخل الحاوية يتصل بقاعدة `test`** — حدد `dzhoof-iptv` دائمًا.
6. **النشر ~10 دقائق**؛ انتظر `DEPLOY COMPLETE` ولا تقاطعه؛ النسخ الاحتياطي تلقائي قبل كل نشر.
7. **جدولة الإشعارات**: حقل `datetime-local` يُفسَّر بمنطقة الخادم — فرق ساعة محتمل مع متصفح المستخدم (نُوِّث في تقرير الجولة 13).
8. كود الخادم يجب أن يمر على CI كاملًا قبل النشر (tsc + eslint + jest) — الجولة 13 كان كل شيء أخضر قبل الدفع.

---

## 8. الحالة النهائية

- GitHub `main` = `b024e55` (جولتان: `50bb33f` الكود + `b024e55` التقرير بالتحقق الحي) — متزامن مع الخادم.
- الإنتاج `v1.0.1-20260824T195220Z` سليم، والقنوات تشتغل في تطبيق DZ Hoof (~90% من العينة).
