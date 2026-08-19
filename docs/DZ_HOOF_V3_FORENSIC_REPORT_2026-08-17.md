# DZ HOOF V3 — تقرير التحقيق الجنائي لمسار البث

## النطاق

تمت مراجعة مسار التشغيل من M3U إلى Live URL ثم redirect وHLS child playlist وsegments، مع مقارنة ثلاثة HTTP profiles طبيعية: native backend، browser-like، وVLC-compatible. أُجريت الاختبارات server-side فقط، من دون تجاوز Cloudflare أو WAF أو CAPTCHA أو تدوير عناوين IP أو استخراج cookies من VLC.

## الأدلة المسجلة

| المرحلة | النتيجة | الدلالة |
|---|---:|---|
| تنزيل M3U | 4,142 قناة في العينة | المصادقة والوصول إلى metadata يعملان |
| Live request قبل redirect | HTTP 302 | المزود يصدر رابط تشغيل مؤقتاً إلى host آخر |
| Redirect target | HTTP 200 | الاستجابة النهائية ليست دليلاً على playable stream |
| Content-Type النهائي | `text/html; charset=UTF-8` | ليست M3U8 أو MPEG-TS صالحة للتشغيل |
| Body bytes | 0 في بيئة التشخيص | لا توجد bytes قابلة للتمرير إلى العميل |
| Native / Browser / VLC profiles | النتيجة متطابقة وظيفياً | لا يوجد فرق توافق بسيط في User-Agent يفسر العطل |
| Cookie presence | ABSENT | لم يظهر server-side flow مشروع يعتمد على Set-Cookie في هذه العينة |

> **الاستنتاج:** نجاح M3U وHTTP 302 لا يعني نجاح Live Playback. في الاختبار الحالي يصل DZ HOOF إلى redirect صادر من المزود، لكن نقطة النهاية تعيد HTML بدلاً من manifest أو MPEG-TS قابل للقراءة. وبما أن profiles الثلاثة أعطت النتيجة نفسها، فالسبب المثبت خارجي في upstream/provider أو في سياسة الوصول المرتبطة ببيئة الخادم، وليس في إخفاء رابط العميل داخل DZ HOOF.

## الإصلاح الداخلي

تم إصلاح إعادة بناء روابط HLS النسبية في [`server/backend/src/services/upstream-proxy.ts`](../server/backend/src/services/upstream-proxy.ts). كان relay يبني الروابط النسبية باستخدام directory string فقط؛ وهذا قد يكسر مسارات تحتوي `../` أو مسارات نسبية متداخلة. أصبح الحل يستخدم `new URL(relative, finalUrl)` وفق قواعد URL القياسية، مع استمرار تحويل كل manifest URI إلى playback token وعدم كشف upstream URL للعميل.

تظل خصائص الأمان الحالية فعالة: SSRF validation وpinned DNS lookup ورفض redirect إلى private/internal IPs وAES-encrypted playback token وredaction في السجلات، إضافة إلى إغلاق upstream socket عند إلغاء العميل.

## الملفات المضافة

أُضيف محرك تشخيص إلى [`scripts/stream-diagnostics/forensic.js`](../scripts/stream-diagnostics/forensic.js) مع توثيق الاستخدام في [`scripts/stream-diagnostics/README.md`](../scripts/stream-diagnostics/README.md). المحرك يسجل DNS وresolved IP وredirect chain وstatus وcontent type وcontent length وTTFB وlatency وbyte count وfirst bytes، ويخفي username/password/token/authorization/cookie values. لا تُحفظ أجسام الاستجابات في التقرير.

## التحقق

نجح `npm run typecheck` في backend، ونجحت اختبارات `stream-health-service.test.ts` و`stream-session-service.test.ts` وعددها ستة اختبارات. كما أُعيد تشغيل matrix التشخيص بعد إصلاح redaction، ولم تظهر بيانات الاعتماد في المخرجات.

## ما لم يُدَّعَ حله

لم يتم الادعاء بأن مزود Lynx أصبح قابلاً لإعادة البث. الأدلة الحالية تثبت أن طبقة DZ HOOF تستطيع الوصول إلى metadata والredirect، لكنها لا تحصل من upstream على bytes تشغيل صالحة من بيئة الخادم. الحل المشروع التالي هو طلب provider/reseller يسمح صراحةً بإعادة البث من VPS أو تزويد HTTP profile موثق من المزود، ثم إعادة تشغيل نفس الاختبار.
