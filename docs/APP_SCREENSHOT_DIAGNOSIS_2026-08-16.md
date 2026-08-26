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


## تحديث 2026-08-26 — تشخيص فشل تثبيت APK

أظهرت لقطات الهاتف رسالتي Google Play Protect «تطبيق محظور لحماية جهازك» و«Application non installée». بمراجعة خط CI تبين أن artifact السابق المسمى `dzhoof-staging-production-apk` كان في الحقيقة `app-staging-debug.apk`، أي نسخة debug غير مناسبة لتوزيع العملاء. كما أن flavor staging يستخدم applicationId مختلفاً (`com.dzhoof.iptv.staging`) عن النسخة الرسمية، وقد يؤدي اختيار الملف الخطأ إلى تعارض أو فشل التثبيت.

تم تصحيح workflow الإصدار الرسمي ليبني ويتحقق من `app-official-release.apk` فقط، ويفحص توقيع APK و`applicationId=com.dzhoof.iptv` و`versionName`، ويرفق SHA-256. تم تشغيل الإصدار `1.0.15` عبر [Release Candidate workflow](https://github.com/mostafabonnif-beep/dzhoot/actions/runs/33007663643)، ونجحت كل الخطوات، بما فيها Build signed release APK وVerify and package official release APK وUpload official signed release APK.

القاعدة التشغيلية: لا تُرسل `staging-debug` أو `staging-release` إلى العملاء. يجب استخدام `app-official-release.apk` الموقّع بنفس keystore السابق للتحديث فوق النسخة المثبتة. إذا كانت نسخة الهاتف القديمة موقعة بمفتاح مختلف، فسيطلب Android إزالة النسخة القديمة قبل التثبيت؛ لا ينبغي تجاوز Play Protect، بل يجب إعادة البناء بالمفتاح الرسمي أو تثبيت الإصدار الرسمي عبر قناة موثوقة.

الإصدار الرسمي السابق `1.0.14` اجتاز CI وكان حجمه نحو 74 MB. الإصدار الأحدث `1.0.15` اجتاز خط التحقق المحسن، لكن تنزيل artifact من بيئة التدقيق انقطع بسبب مهلة الشبكة، بينما بقي artifact محفوظاً في GitHub Actions.


## تحديث 2026-08-26 — نقلة تجربة الهاتف

تم تحسين `ComposeMainActivity` وإدراج البحث كوجهة أساسية في شريط الهاتف السفلي. أصبح شريط الهاتف يحتوي خمس وجهات عالية الاستخدام: الرئيسية، البحث، المفضلة، التصنيفات، والإعدادات. بقي شريط Android TV منفصلاً ومحتفظاً بالتنقل الخاص بالريموت، كما بقيت الدليل وVOD متاحين من مساراتهما المناسبة.

نجحت فحوص CI بعد إصلاح تعارض Kotlin: Android lint وunit tests وassemble debug، إضافة إلى frontend وbackend وsecret guard. تم دمج الإصلاح عبر PR #71، ثم بناء الإصدار الرسمي `1.0.16` عبر [Release Candidate workflow](https://github.com/mostafabonnif-beep/dzhoot/actions/runs/33012013143)، ونجحت خطوات التوقيع والتحقق ورفع official APK. هذا الإصدار يختلف فعلياً في التنقل عن 1.0.15، وليس مجرد إعادة توقيع.
