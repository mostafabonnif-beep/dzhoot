# DZ HOOF — تقرير إصلاح مسار التشغيل

**التاريخ:** 2026-08-16

## النتيجة التنفيذية

تم إصلاح خلل قابل للمعالجة في مسار Android: رابط `playback-token` هو رابط opaque بلا امتداد، ولذلك كان Media3 مضطراً إلى تخمين نوع الوسائط. أصبح Backend يعيد الآن `mimeType` صريحاً (`application/vnd.apple.mpegurl` لـ HLS و`video/mp2t` لـ MPEG-TS)، ويستخدم Android هذه القيمة عند إنشاء `MediaItem` وفي جميع مسارات إعادة المحاولة والبدائل.

كما تم إصلاح OkHttp interceptor. قبل الإصلاح كان يرسل `Accept: application/json` وبيانات `X-TV-Code` و`X-Session-Id` مع كل طلب، بما في ذلك طلبات manifests وsegments والمصادر الخارجية. أصبح الآن يرسل `Accept: */*` لطلبات playback، ويضيف headers الخاصة بالمستخدم فقط إلى خادم DZ HOOF، فلا تُرسل بيانات الجلسة إلى مصدر IPTV خارجي.

## الملفات المعدلة

| الجزء | التعديل |
|---|---|
| Backend `routes/tv.js` | inference لنوع HLS/TS وإضافة `mimeType` إلى رد playback-token |
| Android `PlaybackTokenDtos.kt` | قراءة `mimeType` الاختياري مع الحفاظ على التوافق |
| Android `PlaybackTarget.kt` | نموذج رابط التشغيل ونوعه |
| Android `PlayerViewModel.kt` | تمرير MIME type بدلاً من إسقاطه |
| Android `PlayerScreenEffects.kt` | تهيئة MediaItem مع MIME type |
| Android `ErrorRecoveryManager.kt` | الحفاظ على MIME type عند البدائل وإعادة المحاولة |
| Android `NetworkModule.kt` | فصل headers الخاصة بالـ API عن طلبات الوسائط والمصادر الخارجية |

## نتائج الاختبارات

| الاختبار | النتيجة |
|---|---:|
| Backend Jest | 189/189 ناجحاً، 26/26 suite |
| Android Kotlin unit tests | ناجحة بالكامل، 55 suite |
| Android compileDebugKotlin | ناجح |
| Android assembleDebug | ناجح |
| Backend health | `status=ok`, MongoDB متصل |
| playback-token | HTTP 200 و`mimeType=application/vnd.apple.mpegurl` |
| HLS master manifest | 4,088 bytes |
| HLS child playlist | 11,564 bytes |
| أول TS segment | يبدأ بالتوقيع `47 40 00 10` |

## حالة Xtream

هذا الإصلاح لا يمكنه إنشاء فيديو عندما يكون المصدر الأصلي محجوباً. حساب Xtream الحالي ما زال يصادق بنجاح على `player_api.php`، لكنه يعيد HTTP 456 مع صفر bytes لكل مسارات Live Playback وHTTP 884 مع صفر bytes عند M3U export. لذلك لا يزال Backend، وفق سياسة حماية العملاء، يمنع إظهار قنوات Xtream غير المتحققة. يلزم أحد الحلول التالية من مزود المحتوى: السماح بعنوان IP الخاص بالخادم، حساب B2B/Reseller يدعم server-side restream، أو رابط live صالح من نفس المصدر، أو حساب بديل يسمح بالبث من الخادم.

## APK

تم بناء APK Debug النهائي بعد الإصلاح:

`android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256:

`ede190042eeeadf85a265c08f7f1e4e0191bdc6840e049042adda1102a2e1a72`

## ملاحظة بيئة الاختبار

الخادم يعمل على نفس عنوان الاختبار الحالي، وقاعدة MongoMemoryServer بقيت متصلة بعد إعادة التشغيل. قنوات الاختبار الظاهرة حالياً هي القنوات العامة الثلاث الموجودة في catalog؛ نجاح media pipeline مؤكد، بينما ظهور 16,609 قناة Xtream يتطلب upstream يسمح فعلياً بتسليم bytes.
