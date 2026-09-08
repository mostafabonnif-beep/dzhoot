# تقرير تسليم — الجولة المميزة v1.1.0 (2026-09-08)

> جولة تطوير لتطبيق DZ HOOF (Android / Android TV / Box): ميزات جديدة + تحقق بناء + تحليل تنافسي.
> الفرع: `feature/v1.1.0-matches-today-vod-speed` — الالتزامات: b693bc1 (الميزات) و4858b45 (التقرير التنافسي).

## ما تم إنجازه في هذه الجولة

### 1) صف «مباريات اليوم» على الصفحة الرئيسية (هاتف + تلفاز + Box)
- مصدر البيانات: `GET /api/v1/tv/epg/:code/matches-today` — نقطة نهاية موجودة ومنشورة في الإنتاج (لا حاجة لأي تغيير خادمي).
- يعرض مباريات اليوم الحية/القادمة (مستنتجة من EPG الخادم): بطاقة لكل مباراة بشارة «مباشر» حمراء أو وقت الانطلاق، واسم القناة الناقلة.
- الضغط على أي بطاقة يفتح القناة مباشرة في المشغّل (نفس سلوك بطاقات القنوات).
- يختفي الصف تلقائيًا: لا مباريات اليوم / الجهاز غير مربوط / فشل الاتصال (لا يكسر الصفحة أبدًا).
- ملفات: `EpgDto.kt` (DTOs)، `domain/model/SportsMatch.kt`، `EpgRepository(+Impl)`، `DzhoofApiService.kt`، `SportsMatchUiModel.kt` (مع فرز مباشر←قادم وتوقيت محلي)، `ChannelsViewModel/UiState`، `HomeContent.kt`، `HomeRows.kt` (البطاقات)، `strings.xml`.

### 2) التحكم بسرعة تشغيل VOD (أفلام/مسلسلات)
- زر عائم أعلى مشغّل VOD يدور عبر: 0.75× ← 1× ← 1.25× ← 1.5× ← 2×.
- السرعة تبقى سارية على العنصر التالي في نفس الجلسة؛ تبدأ من 1× عند كل فتح.
- ملف: `VodPlayerScreen.kt` (+ دالة دائرية نقية قابلة للاختبار).

### 3) اختبارات الوحدة
- `SportsMatchUiModelTest`: تعيين الحقول، تنسيق الوقت المحلي، الفرز (مباشر أولًا ثم وقت الانطلاق)، الحالات الفارغة.
- `VodPlaybackSpeedTest`: دورة السرعات، الالتفاف، التسميات.
- النتيجة المؤكدة: **458/458 اختبارًا ناجحًا** في متغير `testOfficialReleaseUnitTest` (0 فشل/خطأ).

### 4) التقرير التنافسي (عربي)
- `docs/COMPETITIVE_REPORT_v1.1.0_AR.md`: مقارنة بـ Neo4K Pro وIBO Player Pro وTiviMate وIPTV Smarters Pro وXCIPTV وOTT Navigator وSTB Emu وGSE Smart IPTV + مصفوفة ميزات 28 بندًا + خارطة طريق أفضل 10 ميزات.

## التحقق من البناء
- بيئة البناء: VPS (JDK 17 + Android SDK 34 + keystore الإنتاج) — نفس خط إنتاج v1.0.50.
- بناء تحكّم v1.0.50 من المصدر الحالي: نجح (7:04 د) وحجم APK مطابق لإنتاج الإنتاج بالبايت (23,268,345) → إثبات تطابق خط البناء.
- بناء v1.1.0: **BUILD SUCCESSFUL (8:55 د)** — `assembleOfficialRelease` + `testOfficialReleaseUnitTest`.
- التحقق النهائي:
  - apksigner: موقّع بشهادة الإنتاج `CN=DZ HOOF IPTV, OU=Production, O=..., C=DZ` — SHA-256 `5938049a…`
  - aapt badging: `com.dzhoof.iptv` — versionName **1.1.0** / versionCode **10100** — minSdk 28 / targetSdk 34.
  - SHA-256 للملف: `1f8359cd75afe9edb5a81998222fe4703d0eed84a709c0e5401f8ec42c0d66af` — الحجم 23,285,529 بايت.
- ملاحظة تشغيلية: بناء الاختبارات + R8 معًا على خادم إنتاج (5.8GB RAM) سبّب ضغط ذاكرة وOOM جزئي؛ أُعيد البناء بنجاح. للجولات القادمة: شغّل `testOfficialReleaseUnitTest` ثم `assembleOfficialRelease` كخطوتين منفصلتين، أو ارفع ذاكرة الخادم.

## خطوات النشر للإنتاج (بانتظار موافقة المالك — لم تنفَّذ)
1. اختبار APK يدويًا على هاتف/تلفاز/Box (تثبيت جانبي).
2. رفع `dzhoof-tv-v1.1.0-official.apk` إلى مجلد `downloads` على الخادم.
3. تسجيل صف `AppVersion` جديد (versionName 1.1.0 / versionCode 10100) في MongoDB appversions — ليظهر التحديث داخل التطبيق.
4. دمج الفرع في `main` ورفعه إلى GitHub (يتطلب توكن مستخدم — مفتاح SSH الحالي ليس مفتاح GitHub).

