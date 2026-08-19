# تشخيص لقطة تطبيق DZ HOOF — 16 أغسطس 2026

## الملاحظة المرئية

تظهر في اللقطة قناة `1AlmereTV` ورسالة عربية تفيد بأن البث غير متاح وأن مصدر البث قد يكون متوقفاً. هذه القناة ليست من مصدر Xtream المقدم، بل من كتالوج IPTV-org التجريبي الموجود في بيئة الاختبار.

## التحقق من API

بعد استخدام كود العميل `6QP1I1`، أعاد endpoint:

`GET /api/v1/tv/playlist/6QP1I1/json`

ثلاث قنوات فقط:

| القناة | metadata.source | Xtream ID |
|---|---|---|
| 1KZN TV | iptv-org | غير موجود |
| 1AlmereTV | iptv-org | غير موجود |
| 00s Replay | iptv-org | غير موجود |

هذا يثبت أن التطبيق كان يستلم الكتالوج التجريبي المشترك، وليس قائمة القنوات التي تظهر في `get_live_streams` لدى حساب Xtream.

## حالة المصدر بعد تسجيله في Backend

تم تسجيل المصدر الحالي في Backend بعنوان `https://tv.upstream-host-redacted`، ثم شغّل النظام التحقق الرسمي. النتيجة:

| الفحص | النتيجة |
|---|---|
| API authentication | ناجح، `auth=1`, `status=Active` |
| عدد القنوات في metadata | 16,609 |
| M3U | HTTP 884 وحجم صفر |
| Live m3u8 | HTTP 456 وحجم صفر في 3 قنوات |
| Live TS | HTTP 456 وحجم صفر في 3 قنوات |
| verificationStatus | degraded |
| status | Inactive |
| sync | ممنوع عمداً قبل نجاح Live Playback |

## الاستنتاج

لا يوجد خلل في Android يجعل قنوات Xtream تختفي بعد أن تصل إلى التطبيق؛ قنوات Xtream لم تدخل الكتالوج أصلاً لأن المصدر غير متحقق من Live Playback. نظام الحماية الحالي يتصرف كما صُمم: لا يعرض مصدر metadata-only للعملاء ولا يسمح بمزامنته، بينما يظل كتالوج IPTV-org التجريبي ظاهراً للمستخدم ذي `allCatalog=true`.

إظهار قنوات Xtream الآن يتطلب أن ينجح مصدر Live فعلياً من خادم DZ HOOF، عبر whitelist لعنوان VPS أو حساب B2B/Reseller أو رابط قناة اختبار مرخص. إزالة شرط التحقق ستجعل أسماء القنوات تظهر، لكنها ستُبقي رسالة «البث غير متاح» ولن تحل التشغيل.

## إعادة التحقق بعد إعادة تشغيل Backend

تمت مطابقة APK: `BuildConfig.API_BASE_URL` يشير إلى خادم الاختبار الحالي، ونسخة APK بنيت في 16 أغسطس 2026. تم إعادة تشغيل Backend من آخر commit مع نفس MongoDB، ثم استدعاء endpoint الذي يستخدمه Android فعلياً:

`GET /api/v1/channels` مع `X-TV-Code` و`X-Session-Id`.

النتيجة بقيت `count=3`، وجميع القنوات تحمل `metadata.source=iptv-org`. حالة مصدر Xtream بقيت `Inactive/degraded` مع `lastError=No tested live stream is playable`. لذلك لا توجد مشكلة cache أو APK أو مسار Android في هذه الحالة؛ الهاتف يعرض بالضبط القائمة التي يرسلها الخادم.

## تفسير شاشة «تم التحقق من 3/3»

الشاشة المرفقة تعرض `تم التحقق من 3/3`. هذا الرقم لا يعني أن 16,609 قناة Xtream تم فحصها؛ بل يعني أن الكتالوج الحالي يحتوي 3 قنوات فقط، وهي قنوات `iptv-org` الثلاث التي أعادها `/api/v1/channels`. لذلك ظهور اللون الأخضر في صحة البث لا يثبت دخول مصدر Xtream.

كما فُحصت استجابة Xtream `get_live_streams` كاملة، ولم تحتوِ أي قناة من 16,609 على `direct_source` رسمي بديل يمكن للتطبيق أو Backend استخدامه. هذا يستبعد إضافة direct-source كحل لهذا الحساب تحديداً.
