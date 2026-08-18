# DZ HOOF — الحالة الحالية (ملخص موحّد)

آخر تحديث: 18 أغسطس 2026 — هذا الملف يلخّص أهم ما جاء في عشرات تقارير `docs/` المتراكمة (الفحوصات الجنائية V3/V4/V4.1، تقرير الخبير، تقرير التشغيل، QA baseline...). التقارير الأصلية بقيت كما هي في `docs/` للرجوع التفصيلي؛ هذا الملف هو نقطة البداية بدل قراءة 40+ ملف.

## الخلاصة بجملة واحدة

الكود والهندسة والأمان في مستوى ممتاز (200/200 اختبار خضراء، أمان بث بتوكنات مشفرة، CI شامل)، لكن المشروع **غير جاهز للإطلاق التجاري** لأسباب تشغيلية بحتة: لا يوجد VPS حقيقي بعد، لا يوجد restore drill منفذ فعليًا، ولا يوجد APK مجرب على جهاز TV حقيقي.

## ما تم التحقق منه فعليًا (بيئة اختبار)

- تشغيل كامل Backend+Frontend+MongoDB+Redis على خادم اختبار، مع أول بث فيديو حي من طرف إلى طرف عبر بروكسي المنصة.
- استيراد كتالوج قنوات/أفلام حقيقي عبر Xtream/M3U (وتوثيق مشكلة حجب IP الداتاسنتر لمصادر تجارية — تُحل تلقائيًا عند النشر على VPS بـIP غير محجوب).
- 200 اختبار backend خضراء (27 مجموعة، تغطية ≥70%)، وbuild ناجح للفرونت (39 route)، وaudit dependencies بلا ثغرات high+.
- إصلاح أخطاء تجميع/اختبار في Android، وبناء APK تجريبي (debug، غير موقّع بعد فعليًا على جهاز حقيقي).

## الثلاثة أسباب الحقيقية لعدم "الجاهزية الكاملة" (حسب تقرير الخبير)

1. لا يوجد VPS إنتاجي حقيقي بنطاق وHTTPS بعد — كل الاختبار على بيئة sandbox/فحص.
2. لا يوجد restore drill منفّذ فعليًا على بيانات حقيقية (الأدوات جاهزة في الكود فقط). **[معالج جزئيًا الآن — انظر أدناه]**
3. لا يوجد APK موقّع مُجرّب على جهاز Android TV فعلي.

## آخر التحديثات من هذه الجلسة

- ✅ **جاهزية ما قبل VPS** (طلب جديد):
  - `server/docker-compose.production.yml`: أُضيفت healthchecks حقيقية لـmongodb/redis (بدل انتظار "container started" فقط)، وربطها بـ`depends_on: condition: service_healthy` لـapi وscheduler، وحدود ذاكرة (`deploy.resources.limits`) لتفادي OOM بلا تحكم على VPS صغير.
  - `server/scripts/preflight-production.sh`: تحقق إضافي يرفض `DOCKER_IMAGE`/`DOCKER_FRONTEND_IMAGE` إذا كانت `:latest` أو بلا tag — النشر يبقى قابل لإعادة الإنتاج والتراجع (rollback) واضح.
  - راجعنا `Caddyfile` — سليم كما هو (HSTS، رؤوس أمان، TLS تلقائي عبر ACME_EMAIL)، بلا تعديل.
- ✅ `server/backend/scripts/smoke-m3u-import.ts`: اختبار E2E جديد (نفس نمط `smoke-activation.ts`) يغطي: تسجيل دخول أدمن → إضافة مصدر M3U → مزامنة → ظهور القنوات في الكتالوج، على خادم M3U محلي مؤقت (بلا اعتماد على مصدر خارجي حقيقي). أُضيف كخطوة فـ`.github/workflows/ci.yml`.



- ✅ أُضيف `server/scripts/verify-restore-integrity.mjs` و`server/scripts/seed-drill-data.mjs` و`.github/workflows/restore-drill.yml`: drill أسبوعي تلقائي بمقارنة عدد السجلات قبل/بعد الاستعادة على قاعدة بيانات معزولة في CI. هذا يغطي الفجوة التقنية للبند P0 "restore drill" — يبقى فقط التحقق أن الـworkflow يعدي فعليًا بعد أول تشغيل، وإجراء نفس الاختبار يدويًا مرة على بيانات production حقيقية (مو CI فقط) قبل الاعتماد الكامل.
- ✅ `docs/ALERTING_SETUP_AR.md`: دليل خطوة بخطوة لربط `ALERT_WEBHOOK_URL` بـSlack/Discord/healthchecks.io واختباره.
- ℹ️ `docs/APK_SIGNED_RELEASE_RUNBOOK_AR.md`: تبيّن أن إعداد توقيع الـAPK **موجود ومكتمل في الكود أصلاً** (`build.gradle.kts` + `release.yml`)؛ الناقص هو التشغيل الفعلي فقط (توليد keystore حقيقي، إضافة GitHub secrets، push tag، تجربة على جهاز TV حقيقي) — الدليل يشرح الخطوات.

## لا يزال ناقصًا (يحتاج تنفيذ فعلي على VPS، مو كود إضافي)

- نشر VPS حقيقي + نطاق + HTTPS (الإعداد الآن مراجَع وجاهز — `docker-compose.production.yml` وCaddyfile وpreflight — الناقص هو التنفيذ الفعلي).
- اختبار streaming تحت حمل حقيقي (P0) — يحتاج بيئة staging حقيقية.
- ربط `ALERT_WEBHOOK_URL` بقناة Slack/Discord حقيقية (الدليل جاهز).
- توليد keystore حقيقي وتجربة APK موقّع على جهاز TV فعلي (الدليل جاهز).
- restore drill: تشغيل أول مرة فعلي في CI للتأكد، وتجربة يدوية واحدة على بيانات production حقيقية.
- نظام Reseller والدفع الإلكتروني (مؤجل عمدًا، ليس ضمن MVP).
- تنظيف تحذيرات lint المتراكمة في ملفات قديمة (`@typescript-eslint/no-explicit-any`) — تقرير الأولويات جاهز فـ`LINT_CLEANUP_REPORT_AR.md`، التعديل الفعلي لسا ما بداش.

## فهرس التقارير التفصيلية (للرجوع عند الحاجة)

| الموضوع | الملف |
|---|---|
| فحص خبير شامل 17-08 | `DZHOOF_IPTV_EXPERT_REVIEW_2026-08-17_AR.md` |
| تقرير تشغيل فعلي على خادم فحص | `DZHOOF_RUNTIME_REPORT_2026-08-17_AR.md` |
| قبول ما قبل VPS | `QA_BASELINE_2026-08-16.md` / `DZ_HOOF_PRE_VPS_READINESS_2026-08-17.md` |
| أبحاث Xtream العميقة | `XTREAM_DEEP_RESEARCH_REPORT.md`, `XTREAM_DEEP_RESEARCH_NOTES.md` |
| تحليل تنافسي | `COMPETITIVE_DISCOVERY_2026-08-15_AR.md`, `IPTV_COMPETITIVE_FINDINGS_2026-08-16.md` |
| الفحوصات الجنائية (V3/V4/V4.1) | `DZ_HOOF_V3_FORENSIC_REPORT_2026-08-17.md` وما يليها |
| إعادة العلامة التجارية | `BRAND_IDENTITY_REBRAND_2026-08-16.md`, `DZ_HOOF_PACKAGE_MIGRATION_2026-08-17.md` |

*ملاحظة: هذا الملخص لا يحذف أي تقرير أصلي — كلها موجودة في `docs/` كما هي.*
