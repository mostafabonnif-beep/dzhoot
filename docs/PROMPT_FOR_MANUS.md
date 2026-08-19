# البرومت الشامل — مهمة تطوير DZ HOOF إلى 100/100

> انسخ هذا النص كما هو وأرسله إلى Manus.

---

أنت مهندس خبير في أنظمة IPTV. مهمتك: جعل مشروع **DZ HOOF** (github.com/merci1994dz/dzhoot) جاهزًا 100/100 — منصة IPTV تجارية كاملة، مستقرة، آمنة، قابلة للنشر. التزم بالقواعد التالية واعمل بالترتيب.

## القواعد الإلزامية
1. اقرأ أولًا: `docs/FOR_MANUS.md` (تقرير الفحص + حزم العمل WP1-WP10) و`AGENTS.md` و`PROJECT_ROADMAP.md` و`server/docs/ARCHITECTURE.md`.
2. بعد كل تغيير: `npm run typecheck && npm run lint && npm run test:backend` (يجب: 0 أخطاء + 149 اختبار) في `server/`، و`npx tsx scripts/smoke-activation.ts` (يجب: 33 فحص) في `server/backend/`.
3. لا تعدّل مسارات التجارة (plans/activation-codes/subscriptions/devices/redeem) دون تشغيل اختباراتها.
4. لا تدفع مباشرة إلى main: أنشئ فرع `feature/*` ثم PR إلى `develop` ثم إلى main بعد أخضر CI.
5. الأسرار (`.env`, `google-services.json`, keystore) خارج git نهائيًا.

## أولوية 0 — استقرار لوحة التحكم (عاجل — كسر حي مؤكد)
الفحص الحي (2026-08-13) أثبت أن **10-13 من 19 مسارًا في /admin تعيد HTTP 502** أثناء وبعد إعادة النشر، بينما Backend سليم (كل الـAPI 200):
- أصلح كل المسارات: movies, series, quick-pick, activity, scheduler, epg, import, versions, m3u-sources, sources, channels, settings, users.
- شخّص عبر سجلات Next.js (`next start` ثم فتح المسارات، أو `docker compose logs`).
- **أضف اختبار E2E بـPlaywright** (البنية موجودة: `server/playwright.config.ts` + مجلد `e2e`): دخول → زيارة المسارات الـ19 كلها → تأكد أن كل صفحة تعرض محتوى، وأضفه إلى CI (job frontend).
- لا تكتفِ بـ`next build` — أخطاء التشغيل (SSR crashes) لا يكشفها البناء.

## أولوية 1 — التحقق الآلي الكامل
1. **WP1 — بناء Android في CI**: job جديد (Java 17 + Android SDK + `./gradlew assembleDebug --stacktrace` + artifact للـAPK). أصلح أخطاء الترجمة — تطبيق Android لم يُبنَ قط في بيئة نظيفة.
2. **WP2 — Smoke E2E في CI**: أضف `npx tsx scripts/smoke-activation.ts` كخطوة في job backend.
3. **WP3 — اختبارات واجهة**: أضف RTL tests للصفحات الجديدة (Codes/Plans/Movies/Series/Users) — الحد الأدنى: عرض القائمة + حالة فارغة + خطأ.

## أولوية 2 — النشر الإنتاجي
1. راجع `server/docker-compose.production.yml`؛ أضف HTTPS (Caddy أو NGINX+certbot)؛ لا تترك البورتات مكشوفة.
2. أتمتة `backup.sh` عبر cron + توثيق `restore-drill.sh` + نسخة دورية لـuploads.
3. أنشئ `.env.production.example` بكل المتغيرات موثقة: MONGODB_URI, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, XTREAM_SECRET_KEY, SUPER_ADMIN_USERNAME/EMAIL/PASSWORD, APP_URL, PORT.
4. Health checks ومراقبة (Sentry موجود) + تنبيهات انقطاع.
5. **إجبار تغيير كلمة مرور superadmin الافتراضية عند أول دخول** (حقل mustChangePassword أو تحذير حاسم) — المنصة المنشورة حاليًا بالكلمة الافتراضية.

## أولوية 3 — إكمال الوظائف الناقصة
1. **WP4 — FCM**: firebase-messaging في Android + تسجيل pushToken عند الخادم + ربط `admin-notifications /send` بإرسال فعلي (FCM HTTP v1) + صفحة إشعارات في اللوحة (قائمة، إنشاء، إرسال، حذف) — **غير موجودة في اللوحة**.
2. **WP5 — فرض الاشتراك من طرف لطرف**: تطبيق Android يستدعي `POST /streams/authorize` قبل كل تشغيل؛ عند 403 SUBSCRIPTION_EXPIRED شاشة "فعّل كودك"؛ سجّل الجهاز عند أول تشغيل؛ فعّل `subscription_required` في الإنتاج.
3. **WP6 — إدارة Xtream في اللوحة**: الصفحة موجودة — أضف لكل مصدر: زر Test Connection، زر Sync، عرض syncStatus/lastError/lastSyncAt/stats، وتحديث الحالة لحظيًا.
4. **أكواد التفعيل**: أضف بحثًا بآخر 4 أرقام (موجود في الـAPI — اربطه بالواجهة)، وعرض `codeExpiresAt`، وتصدير CSV لنتيجة التوليد.

## أولوية 4 — التحصين الأمني (قبل الإطلاق)
1. **2FA (TOTP)** للمشرفين + صفحة تفعيل في الإعدادات.
2. Rate-limit على `/activation/redeem` و`/auth/login` (منع تخمين الأكواد وكلمات المرور).
3. Device lock اختياري لكل باقة (ربط الاشتراك بأول جهاز).
4. `npm audit` وترقية `multer` إلى 2.x (ثغرات معروفة).
5. مراجعة: التوكنات القصيرة تُفسَخ عند تغيير كلمة المرور/التعليق.

## أولوية 5 — اكتمال المنتج (100/100)
1. **WP8 — اللغات**: ملفات i18n كاملة FR/EN (العربية تمت) للوحة والتطبيق + RTL/LTR.
2. **حالات UI**: Loading (Skeleton) / Empty / Error موحدة في كل الشاشات الجديدة.
3. **سجل النشاط والتقارير**: صفحة إحصائيات تشغيل حقيقية (StreamPlayReport موجود) — أكثر القنوات مشاهدة، أعلى المستخدمين نشاطًا، رسوم بيانية زمنية.
4. **جدول المهام**: اربطه بمزامنة Xtream/M3U/EPG التلقائية المجدولة.
5. **إصدارات التطبيق**: جهّز مسار GitHub Releases للـAPK (workflow release موجود داخل android/.github — انقله للجذر وشغّله).
6. **WP10 — البنية**: أنشئ `develop`، فعّل كاش Redis للكتالوج/EPG، رقّع الاعتماديات المؤجلة.
7. **WP9 — الموزعون** (V2 بعد الاستقرار): الأساس موجود (`resellerId` في أكواد التفعيل) — نفّذ لوحة موزع + رصيد + تقارير (أفكار فقط من XtreamPulsar — BSL: لا نقل كود).

## قواعد خبير IPTV (لا تنتهك)
- لا تمرّر الفيديو عبر Node.js — روابط موقّعة قصيرة العمر مباشرة إلى المصدر/CDN (مُنجز — حافظ عليه).
- HLS أساس؛ DASH لاحقًا عند الحاجة.
- حقوق المحتوى مسؤولية المشغّل — لا تُضف قوائم مشكوكًا فيها.
- MIT/Apache = أخذ مع الحقوق؛ GPL/BSL = أفكار فقط.

## تعريف "جاهز 100/100" (قائمة التحقق النهائية)
- [ ] كل مسارات /admin الـ19 تعرض محتوى (Playwright يتحقق في CI)
- [ ] CI أخضر بالكامل: typecheck + lint + 149 اختبار + smoke 33 + frontend build/test + **Android assembleDebug** + **Playwright E2E**
- [ ] Android APK قابل للتثبيت يُبنى من CI
- [ ] FCM يوصّل إشعارًا لهاتف حقيقي
- [ ] المستخدم بلا اشتراك يُمنع من التشغيل برسالة واضحة
- [ ] نشر HTTPS على VPS + نسخ احتياطي مؤتمت + استعادة موثقة
- [ ] 2FA للمشرفين + rate-limits + كلمة المرور الافتراضية مرفوضة
- [ ] عربية/فرنسية/إنجليزية + RTL/LTR
- [ ] المسار الكامل يعمل: أدمن → مصدر Xtream/M3U → مزامنة → باقة → كود → تفعيل → جهاز → تشغيل → EPG → سجل → إحصائيات
- [ ] حالات الفشل مختبرة: اشتراك منتهي، كود مستخدم/ملغي/منتهي، حد أجهزة، مصدر متوقف، API غير متاح، كتالوج فارغ، فشل تشغيل
