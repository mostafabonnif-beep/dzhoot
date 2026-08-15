# DZ HOOF — خارطة تطوير المشروع

آخر تحديث: 2026-08-15 (جولة الاكتشاف التنافسي)

## 1. هدف المشروع

DZ HOOF منصة IPTV قانونية لإدارة وتشغيل المصادر التي يملك المشغل حق استخدامها. تتكون المنصة من:

- تطبيق Android وAndroid TV.

- لوحة تحكم Admin.

- Backend API.

- إدارة مصادر M3U وXtream.

- مزامنة القنوات وEPG.

- إدارة المستخدمين والأجهزة.

- مشغل Media3/ExoPlayer.

- اشتراكات وأكواد تفعيل في مرحلة لاحقة.

DZ HOOF لا يوفر قنوات أو أفلامًا أو اشتراكات جاهزة. كل مصدر يضاف إلى المنصة يجب أن يكون مصرحًا باستخدامه.

## 2. القرار المعماري الثابت

نحتفظ بخادم FireVision المعاد تسميته كأساس أولي لأنه يوفر حاليًا:

- تسجيل الدخول والمستخدمين والصلاحيات.

- استيراد M3U وإدارة القنوات والتصنيفات.

- EPG بصيغة XMLTV.

- ربط الأجهزة عبر PIN وQR.

- قوائم M3U وJSON للمستخدمين.

- Proxy وفحص صحة القنوات.

- لوحة تحكم وDocker وRedis وMongoDB.

لا ندمج مشروعًا كاملًا آخر داخل DZ HOOF. نستفيد من المشاريع التالية كمرجع أو ننقل وحدات مستقلة بعد مراجعة الرخصة:

- AerioTV-Android: تجربة Android TV وVOD وSeries وEPG — MIT.

- clubTivi: مطابقة EPG ودمج المصادر وFailover — Apache-2.0.

- Ultra TV: Stalker وVOD وSeries والمسارات الصوتية والترجمة — MIT.

- M3UAndroid: مرجع قوي، لكن GPL-3.0 يحتاج التزامًا قانونيًا كاملًا عند الدمج.

- XtreamPulsar: مرجع للباقات والأجهزة والاشتراكات، لكن BSL 1.1 يمنع استخدامه التجاري المستضاف دون مراجعة الترخيص.

المصادر:

- [https://github.com/jonzey231/AerioTV-Android](https://github.com/jonzey231/AerioTV-Android)

- [https://github.com/clubanderson/clubTivi](https://github.com/clubanderson/clubTivi)

- [https://github.com/khalilbenaz/ultra-tv](https://github.com/khalilbenaz/ultra-tv)

- [https://github.com/oxyroid/M3UAndroid](https://github.com/oxyroid/M3UAndroid)

- [https://github.com/dearbulut/xtreampulsar](https://github.com/dearbulut/xtreampulsar)

## 3. نطاق النسخة الأولى MVP

### مطلوب قبل اعتبار النسخة الأولى قابلة للتجربة

- [ ] عنوان HTTPS حقيقي للـAPI بدل `https://dzhoof.example/`.

- [ ] تشغيل Backend مع MongoDB وRedis.

- [ ] تسجيل دخول المشرف.

- [x] إضافة مصدر M3U مصرح به.

- [ ] مزامنة القنوات والتصنيفات.

- [ ] ظهور القنوات في لوحة التحكم والتطبيق.

- [ ] تشغيل قناة عبر Media3/ExoPlayer.

- [ ] ربط Android TV عبر PIN أو QR.

- [ ] EPG يعمل عند توفر XMLTV.

- [ ] البحث والمفضلة.

- [ ] فحص حالة القنوات.

- [ ] اختبار الأخطاء: مصدر متوقف، قناة فارغة، انتهاء PIN، انقطاع API.

- [ ] إنشاء APK Debug قابل للتثبيت.

### لا يدخل في MVP

- الدفع الإلكتروني.

- نظام الموزعين.

- الاشتراكات المدفوعة النهائية.

- DRM.

- CDN متعدد المناطق.

- تطبيق iOS.

- تحليلات تجارية متقدمة.

## 4. مراحل التنفيذ

### المرحلة 0 — تنظيف الأساس

الهدف: جعل المستودع واضحًا وقابلًا للعمل الجماعي.

- [x] إنشاء مستودع GitHub واحد للمشروع.

- [x] إضافة README وAGENTS وCONTRIBUTING وSECURITY.

- [ ] إزالة أسماء FireVision الظاهرة من الواجهة والوثائق.

- [ ] تثبيت اسم الحزمة النهائي بعد مراجعة Firebase.

- [x] منع رفع `.env` و`local.properties` وملفات التوقيع.

- [x] توثيق الرخصة وحقوق المشاريع التي تم الاعتماد عليها.

### المرحلة 1 — تشغيل الخادم

الهدف: تشغيل لوحة الإدارة محليًا ثم على VPS.

- [ ] إعداد `.env` محليًا من `.env.example`.

- [ ] تشغيل Docker Compose.

- [ ] إنشاء حساب المشرف.

- [ ] اختبار `/health`.

- [ ] إضافة مصدر M3U مصرح به.

- [ ] اختبار المزامنة والتصنيفات وEPG.

- [ ] إعداد HTTPS ونسخ احتياطية قبل النشر العام.

### المرحلة 2 — تثبيت تطبيق Android TV

الهدف: تطبيق يعمل فعليًا مع خادم DZ HOOF.

- [x] إصلاح توافق package ID مع Firebase عبر `com.dzhoof.iptv` والتحقق الاختياري من `google-services.json` في CI/Release.

- [x] تثبيت `BuildConfig.API_BASE_URL` و`BuildConfig.FIREBASE_ENABLED` وإزالة الاعتماد التشغيلي على إعدادات Firebase غير الموجودة.

- [x] ضبط API URL عبر `dzhoofApiUrl` أو `DZHOOF_API_URL` مع فرض HTTPS.

- [ ] اختبار Android TV وFire TV.

- [ ] اختبار PIN وQR.

- [ ] اختبار التشغيل وتبديل القنوات والمفضلة وEPG.

- [ ] إضافة اسم وشعار DZ HOOF النهائيين.

- [ ] إخراج APK Debug ثم Release موقّع.

### المرحلة 3 — تحسين تجربة GENRAL-TV

الهدف: الاقتراب من التجربة التي أعجبت المستخدم دون نسخ التصميم أو الموارد.

- [ ] Home ديناميكي.

- [ ] صفوف Live TV وFavorites وRecently Watched.

- [ ] بطاقات قنوات وبطاقات محتوى أفضل.

- [ ] شاشة تفاصيل القناة.

- [ ] شاشة Player محسنة.

- [ ] بحث شامل.

- [ ] دعم RTL والعربية.

- [ ] تحسين التنقل بالريموت والتركيز البصري.

### جولة الاكتشاف التنافسي — 2026-08-15

- [x] البحث الموحد في Backend بالقنوات والأفلام والمسلسلات وبرامج EPG.

- [x] البحث عن برامج EPG الحالية والقادمة والمُنتهية حديثًا ضمن نافذة ساعتين للـCatch-up.

- [x] ربط Android بواجهة البحث الموحد مع نماذج DTO وdomain وrepository.

- [x] عرض نتائج القنوات والمحتوى والبرامج في أقسام مستقلة على الهاتف وAndroid TV.

- [x] تعريب عناوين Home والبحث وإزالة رابط دليل FireVision القديم.

- [x] توثيق عقد API في `docs/CATALOG_SEARCH_API.md`.

- [x] توثيق جولة الاكتشاف التنافسي بتاريخ 2026-08-15 في `docs/COMPETITIVE_DISCOVERY_2026-08-15_AR.md`.

- [x] ربط نتيجة المسلسل بصفحة تفاصيل/مواسم مباشرة بدلاً من فتح الكتالوج العام.

- [x] إضافة بطاقات Poster وصور المحتوى داخل نتائج البحث.

- [ ] اختبار Android على جهاز TV فعلي أو Emulator ضمن CI.

### جولة Control Plane للقنوات — 2026-08-15

- [x] مقارنة DZ HOOF مع TiviMate وSparkle TV وOTT Navigator وIPTV Smarters وTelevizo وTvheadend وJellyfin.

- [x] إضافة `health` URL-free إلى استجابات القنوات مع Availability Score وحالة `primary/fallback/probe/offline`.

- [x] إضافة `m3uSourceId` إلى Channel metadata وshared schema حتى يعمل ربط EPG لمصادر M3U بصورة موثوقة.

- [x] إضافة مؤشرات EPG التشغيلية: مدة آخر تحديث، البرامج المعالجة، عدد أخطاء المصادر، وعينات مصادر الخطأ.

- [x] إضافة `GET /api/v1/admin/stats/channel-operations` لدمج صحة القنوات والمصادر وEPG في Control Plane واحد.

- [x] إضافة بطاقة عمليات القنوات في لوحة الإدارة مع typed API client.

- [x] توثيق العقد في `docs/CHANNEL_OPERATIONS_API.md` وإنشاء مقارنة السوق في `CHANNELS_COMPETITIVE_COMPARISON_AR.md`.

- [x] إضافة Channel Identity آمنة تربط القنوات ذات tvg-id الحقيقي عبر مصادر M3U وXtream، مع confidence ورفض الدمج التلقائي للاسم المجهول.

- [x] تشغيل reconciliation بعد مزامنة M3U وXtream وإتاحة reconciliation يدوي للمشرف.

- [x] تحسين Failover بحفظ رؤوس المصدر البديل داخل playback token المشفر وتمريرها إلى proxy بعد promotion، مع حماية CRLF.

- [x] إضافة معاينة مزامنة وrollback لمصادر M3U/Xtream قبل تعطيل القنوات المختفية.

- [x] إضافة EPG Coverage وUnmatched Console لكل مصدر مع endpoint آمن ولوحة إدارة.

- [x] تمرير health score وidentity إلى Android عبر transient cache دون Room migration، وعرض score اختياري على بطاقة القناة.

- [x] ربط health score بترتيب المفضلة والقنوات الصحية في Android TV، مع focus restoration وprevious channel.

- [x] إضافة telemetry مجهول لتجربة التشغيل: زمن البدء، rebuffer، وفشل/نجاح التحويل إلى البديل، مع تجميع يومي للمشرف.

### المرحلة 4 — VOD وSeries

الهدف: إضافة الأفلام والمسلسلات عندما يوفر المصدر بياناتها.

- [ ] نماذج Movies وSeries وSeasons وEpisodes.

- [ ] استيراد Xtream VOD وSeries.

- [ ] صور وبيانات المحتوى.

- [ ] شاشة تفاصيل الفيلم.

- [ ] شاشة المواسم والحلقات.

- [ ] Continue Watching.

- [ ] حفظ سجل المشاهدة.

- [ ] تشغيل الترجمة والصوت عند توفرهما.

### المرحلة 5 — الاشتراكات وأكواد التفعيل ✅ (أُنجزت النواة في 2026-08-10 )

الهدف: تجهيز المنتج التجاري دون ربطه بالدفع في البداية.

- [x] Plans (موديل + API + لوحة تحكم).

- [x] Activation Codes (توليد دفعات، تخزين hash، عرض النص مرة واحدة، CSV).

- [x] Redeem Code (POST /api/v1/activation/redeem).

- [x] Subscription Events (سجل محاولات التفعيل ActivationRedemption).

- [x] تاريخ بداية ونهاية الاشتراك (المدة تبدأ عند التفعيل).

- [x] ربط الاشتراك بالأجهزة (GET/POST/DELETE /api/v1/me/devices).

- [x] حد الأجهزة (يُفرض عند التسجيل والتفعيل).

- [ ] حد الاتصالات المتزامنة (يبقى مع طبقة حماية البث).

- [x] إلغاء كود غير مفعّل (revoke) — إلغاء اشتراك نشط يبقى لاحقًا.

- [ ] منع الوصول بعد الانتهاء (يُفرض عبر Stream Authorization القادمة).

- [x] سجل تدقيق لكل عملية (audit log + سجل تفعيل لكل محاولة).

التحقق: `npx jest` (106/106) + `npx tsx scripts/smoke-activation.ts` (دورة كاملة على خادم حقيقي).التوثيق: `server/docs/SUBSCRIPTION_SYSTEM.md`.

الدفع الإلكتروني يبقى خارج هذه المرحلة حتى تتحدد الدولة والأسواق ومزود الدفع والالتزامات القانونية.

### المرحلة 5.5 — Catch-up / Timeshift ✅ (أُنجزت النواة في 2026-08-12)

الهدف: تمكين المشترك من مشاهدة برامج سابقة على القنوات الداعمة.

- [x] قراءة خصائص catchup من M3U (`catchup=` / `catchup-source=` / `catchup-days=`).

- [x] تخزين catchup في موديل القناة + تمريره في تصدير M3U.

- [x] Xtream: علامة timeshift لكل قناة + بناء `/timeshift/...` URL من بيانات المصدر المشفرة.

- [x] `POST /tv/playback-token`: دعم `catchupStartMs`/`catchupDurationMin` (M3U قالب أو Xtream) مع:
  - استبدال `{utc}` `{lutc}` `{start}` `{end}` `{duration}`.
  - فرض نافذة المزود (catchup-days) وحد أقصى 24 ساعة للجلسة.
  - أخطاء: `CATCHUP_UNAVAILABLE` / `CATCHUP_OUT_OF_WINDOW` / `INVALID_CATCHUP_TIME`.

- [x] API القنوات: حقل `catchup: {type, days}` في القوائم والتفاصيل — **دون كشف ****`catchup-source`** (قد يحتوي بيانات اعتماد).

- [x] أندرويد: حقل catchup في DTO/Domain/Room (migration v9) + الـ Guide يعرض Catch-up **لكل قناة** بدل تفعيله العام لـ Xtream.

- [x] اختبارات: 144/144 (catchup-service، M3U parse، Xtream sync).

قبل التشغيل بعد الترقية، نفّذ مرة واحدة لترقية القنوات القديمة:`cd server && npm run migrate:catchup-backfill -- --commit`

الملاحظة: دعم `catchup="default"` (إعادة نفس البث) يعتمد على قالب المزود نفسه؛ لا حاجة لكود إضافي.

### المرحلة 5.6 — حد الاتصالات المتزامنة ✅ (أُنجزت النواة في 2026-08-12)

- [x] خدمة `stream-session-service`: تتبع جلسات البث لكل مستخدم في Redis (TTL = مدة التوكن + هامش).

- [x] فرض `MAX_CONCURRENT_STREAMS_PER_USER` (افتراضي 2) على `/tv/playback-token` و`/streams/authorize` — عند التجاوز يُطرد **الأقدم** (سلوك IPTV القياسي: الأحدث يفوز).

- [x] يضيف `streamLimit: {max, active}` لاستجابات البث.

- [x] تعطيل تلقائي عند غياب Redis (لا يمنع التشغيل أبداً).

- [x] اختبارات: 5 حالات (تعطيل، تسجيل، طرد الأقدم، تنظيف المنتهي، عزل المستخدمين).

### المرحلة 5.7 — Parental Controls ✅ (أُنجزت النواة في 2026-08-12)

- [x] PIN 4-6 أرقام مخزّن SHA-256 (لا نص صريح) مع مقارنة ثابتة الزمن.

- [x] قسم "Parental" في الإعدادات: تفعيل القفل، ضبط/تغيير PIN، تعطيل يتطلب PIN الحالي.

- [x] بوابة التشغيل: عند تفعيل القفل، كل قناة تتطلب PIN **مرة واحدة لكل جلسة تطبيق**.

- [x] اختبارات أداة الـ PIN (صحة، hash، تحقق).

### المرحلة 6 — الإنتاج والنشر

- [ ] إعداد VPS وDomain وHTTPS.

- [ ] إعداد MongoDB وRedis بإعدادات آمنة.

- [ ] نسخ احتياطية مجدولة.

- [ ] مراقبة الخادم والأخطاء.

- [ ] اختبار أمني وRate Limiting.

- [x] GitHub Actions للبناء والاختبار.

- [x] GitHub Releases للـAPK عبر workflow الإصدار النهائي.

- [x] توثيق طريقة التثبيت والتحديث.

- [ ] إطلاق Pilot محدود قبل الإطلاق العام.

## 5. تعريف الإنجاز لكل ميزة

لا تعتبر الميزة مكتملة إلا إذا تحقق الآتي:

1. كود الميزة موجود في مكانه الصحيح.

1. لا توجد أسرار داخل الكود.

1. توجد معالجة لحالات الخطأ.

1. يوجد اختبار أو اختبار يدوي موثق.

1. تم تحديث الوثائق وواجهات API عند الحاجة.

1. تم فحص الرخصة إذا استُخدم كود خارجي.

1. تم اختبار Android وAndroid TV عندما تكون الميزة مرتبطة بالتطبيق.

## 6. قواعد GitHub

### الفروع

- `main`: نسخة مستقرة قابلة للتجربة — **لا دفع مباشر إليه** (إلا إصلاحات حرجة موثقة). كل التغييرات تمر عبر feature/fix → PR → merge.

- `develop`: دمج العمل الجاري — الخط النشط للتطوير المتوازي.

- `feature/<name>`: ميزة جديدة.

- `fix/<name>`: إصلاح خطأ.

- `release/<version>`: تجهيز إصدار.

### سياسة الدمج (مطبقة من 2026-08-14 بعد توحيد الخطوط)

1. لا push مباشر إلى `main` — أنشئ `feature/*` من `develop` وافتح PR إلى `main` (أو `develop` ثم `develop → main` دورياً).

1. CI إلزامي أخضر قبل الدمج: backend (typecheck + lint + 152 اختبار + smoke E2E)، android (unit tests + assembleDebug + APK)، frontend (build + tests).

1. الفروع المندمجة تُحذف فوراً؛ أي فرع يبقى أكثر من أسبوع بلا PR يُسأل عنه.

1. تُوحَّد `develop → main` عند كل إصدار (`release/*`) وبعد كل حزمة عمل مكتملة.

### صيغة الالتزامات

استخدم صيغة واضحة:

- `feat: add EPG source management`

- `fix: handle expired pairing PIN`

- `refactor: isolate playlist parser`

- `docs: update deployment guide`

- `test: cover Xtream normalization`

- `build: prepare Android release`

### Pull Request

كل Pull Request يجب أن يذكر:

- ما الذي تغير.

- لماذا تغير.

- طريقة الاختبار.

- هل تغيرت قاعدة البيانات أو API.

- هل توجد أسرار أو إعدادات جديدة.

- الرخصة إذا تم نقل كود خارجي.

## 7. قبل رفع المشروع إلى GitHub

- [ ] لا ترفع `server/.env`.

- [ ] لا ترفع `android/local.properties`.

- [ ] لا ترفع `google-services.json` الحقيقي إذا كان يحتوي على إعدادات مشروع خاص قبل مراجعته.

- [ ] لا ترفع keystore أو كلمات المرور أو مفاتيح Sentry أو OAuth.

- [ ] استبدل القيم الحساسة بقيم في `.env.example` أو `local.properties.example`.

- [ ] راجع `git diff --cached` قبل أول Push.

- [ ] راجع رخصة FireVision وكل مشروع خارجي.

- [ ] لا ترفع `idea-extracted.md`؛ فهو ملف بحث داخلي وليس جزءًا من المنتج.

- [ ] ارفع APK عبر GitHub Releases بدل وضع ملفات البناء الكبيرة داخل Git.

## 8. الخطوة التالية المعتمدة

الخطوة التالية ليست إضافة مشروع جديد. هي:

1. إنشاء هيكل GitHub نظيف.

1. إصلاح إعداد Android وFirebase وAPI URL.

1. تشغيل الخادم محليًا.

1. اختبار مصدر M3U مصرح به.

1. إخراج أول APK Debug.

1. بعدها نبدأ VOD وSeries وEPG المحسن.
