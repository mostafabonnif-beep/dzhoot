# DZ HOOF V4 — Same-Environment Differential Streaming Report

## Executive Result

تم تنفيذ التحقيق على **نفس بيئة التنفيذ التي يعمل فيها backend المحلي حالياً**، وليس على VPS إنتاجي مستقل؛ لا توجد في الجلسة بيانات اتصال أو SSH لـVPS `ld-11.net`. لذلك فإن دليل الاختبار صالح لهذه البيئة فقط، ولا يجوز تقديمه كإثبات نهائي لسلوك عنوان IP الخاص بـVPS الإنتاجي.

> **ROOT CAUSE: H — NOT_DETERMINED** بالنسبة إلى VPS الإنتاجي.
>
> **Evidence on the current execution host:** النتيجة تقارب Case C؛ curl وFFprobe وVLC لم يثبتوا وجود media bytes صالحة، وDZ HOOF forensic لم يحصل على HLS أو MPEG-TS قابل للتشغيل. هذا يرجح أن المشكلة خارج التطبيق في هذه البيئة، لكنه لا يثبت سياسة VPS الإنتاجي قبل تشغيل الاختبار عليه.

## Same-Environment Evidence

| الاختبار | البيئة | النتيجة | التفسير |
|---|---|---|---|
| M3U snapshot | بيئة التنفيذ الحالية | تم استخراج أول stream URL | metadata متاحة من ملف M3U المصرح به |
| curl live | نفس البيئة | HTTP 200 في إحدى المحاولات، `text/html; charset=UTF-8` و1 byte | HTTP 200 ليس media success |
| FFprobe live | نفس البيئة | exit code 1، بلا format أو streams | لم يثبت وجود media container أو codec stream |
| VLC headless | نفس البيئة | timeout، `detectedMedia=false` | لم يثبت فتح MRL أو اكتشاف media؛ رسائل PulseAudio استُبعدت كسبب للبث |
| DZ HOOF forensic | نفس البيئة | redirect 302 ثم HTTP 200 `text/html; charset=UTF-8` و0 bytes في profiles الثلاثة | لا يوجد manifest أو MPEG-TS قابل للتمرير |
| DZ HOOF production relay | VPS الإنتاجي | **NOT TESTED** | لا توجد بيانات اتصال إلى VPS مستقل |

في إعادة أخرى على قناة Lynx ثانية، أعاد curl أيضاً HTML بحجم 1 byte، وفشل FFprobe، ولم يكتشف VLC media. تذبذب status بين 403 و200 HTML ووجود 0–1 byte لا يغيّر التصنيف؛ جميعها تفشل في شرط **valid media bytes**.

## HTTP Differential

تمت مقارنة native وbrowser-like وVLC-compatible profiles في أداة DZ HOOF. لم يظهر profile يثبت وصولاً إلى HLS manifest أو MPEG-TS. كما أن redirect الخارجي انتهى إلى host آخر يعيد HTML بدلاً من content type خاص بـM3U8 أو TS.

| الخاصية | DZ HOOF forensic | curl/FFprobe/VLC |
|---|---|---|
| Redirect | 302 مرصود قبل endpoint النهائي | curl اتبع redirect إلى endpoint النهائي |
| Content-Type النهائي | `text/html; charset=UTF-8` | `text/html; charset=UTF-8` في curl |
| Media bytes | 0 في forensic؛ 1 byte في curl بمحاولة أخرى | FFprobe بلا streams، VLC بلا media detected |
| User-Agent | native/browser/VLC-compatible | curl باستخدام VLC-compatible UA، ثم FFprobe وVLC |
| Cookies | لم يظهر اعتماد على Set-Cookie في هذه العينة | لم تُستخرج cookies أو تُنقل من جهاز خارجي |

هذه المقارنة لا تبرر إضافة User-Agent عشوائي أو cache أو bypass. الحسم النهائي يحتاج تكرارها من VPS الإنتاجي نفسه.

## HLS Differential

| الطبقة | الحالة |
|---|---|
| Master manifest | **NOT TESTED AS VALID HLS**؛ endpoint النهائي أعاد HTML وليس M3U8 |
| Variant playlist | **NOT TESTED**؛ لم تتوفر master playlist صالحة |
| Segment | **NOT TESTED**؛ لم تتوفر variant playlist أو segment URL صالحة |
| MPEG-TS | **NOT PLAYABLE** في الاختبارات الحالية؛ FFprobe لم يكتشف format أو streams |

## Changes

أُضيف [`scripts/stream-diagnostics/v4-matrix.js`](../scripts/stream-diagnostics/v4-matrix.js)، وهو runner يشغل curl وFFprobe وVLC على نفس host، ويحفظ raw artifacts في directory خاص mode `0700` ويعرض summary منقحاً. كما تم تحديث [`scripts/stream-diagnostics/forensic.js`](../scripts/stream-diagnostics/forensic.js) لإخفاء `data` و`expires` signed redirect parameters، وتم تحديث README بالتشغيل والحدود.

أُعيد تنظيم `resolveUpstreamUrl` في [`server/backend/src/services/upstream-proxy.ts`](../server/backend/src/services/upstream-proxy.ts) كدالة قابلة للاختبار، مع استمرار استخدام `new URL(relative, finalUrl)`. أُضيف regression test في [`server/backend/src/services/upstream-proxy.test.ts`](../server/backend/src/services/upstream-proxy.test.ts) للحالات `relative/path.m3u8` و`../playlist.m3u8` و`../../segment.ts` و`segment001.ts` و`/path/segment.ts` والرابط المطلق.

لم تتم إضافة cache أو FFmpeg relay adapter؛ شرط ذلك هو إثبات upstream HTTP 200 مع valid media bytes أولاً.

## Tests

| الأمر | النتيجة |
|---|---:|
| `npm run typecheck` داخل `server/backend` | PASS |
| `npx jest src/services/upstream-proxy.test.ts src/services/stream-health-service.test.ts src/services/stream-session-service.test.ts --runInBand --silent` | 12/12 PASS |
| `npm test -- --runInBand --silent` داخل `server/backend` | 27 suites، 200 tests PASS |
| `npm test -- --runInBand --silent` داخل `server/frontend` | 2 suites، 5 tests PASS |
| `node --check scripts/stream-diagnostics/forensic.js` | PASS |
| `node --check scripts/stream-diagnostics/v4-matrix.js` | PASS |
| V4 curl/FFprobe/VLC matrix على المصدر الأول | curl HTML/no media، FFprobe FAIL، VLC no media |
| V4 curl/FFprobe/VLC matrix على مصدر Lynx ثانٍ | curl HTML/no media، FFprobe FAIL، VLC no media |

## Security

لم تُسجل credentials أو كلمات المرور أو signed `data` parameters في summary أو التقرير. لم تُستخدم cookies من VLC أو جهاز المستخدم، ولم يتم تنفيذ Cloudflare/WAF/CAPTCHA bypass أو IP rotation أو proxy evasion أو fingerprint spoofing. بقيت subscription authorization وplayback tokens وserver-side upstream resolution وSSRF controls وcredential redaction كما هي.

## Git

| البند | الحالة |
|---|---|
| branch | `feature/v4-same-vps-stream-forensics` |
| base | `13b81f7` من V3، دون overwrite |
| working tree | سيتم التحقق قبل الدفع |
| push | سيتم دفع الفرع فقط بعد آخر فحص |
| merge إلى main | لم يتم، وفق متطلبات V4 |

## Remaining Blockers

العائق الرئيسي هو غياب اتصال VPS الإنتاجي. يلزم تشغيل runner على الخادم الذي سيستضيف DZ HOOF، باستخدام M3U أو Live URL محفوظ في environment variables أو secrets file محمي، ثم مقارنة curl وFFprobe وVLC وDZ HOOF من **نفس عنوان IP**. إذا فشلت الأدوات الأربع هناك، يجب إيقاف تعديل التطبيق وتصنيف المشكلة لاحقاً كـ`C — PROVIDER_VPS_AUTHORIZATION` أو `D — PROVIDER_NETWORK_RESTRICTION` أو `E — PROVIDER_UPSTREAM_FAILURE` بناءً على الأدلة. إذا نجح VLC أو FFprobe على ذلك الـVPS وفشل DZ HOOF، عندها فقط يستمر التحقيق كـ`A — APPLICATION_HTTP_COMPATIBILITY` أو `B — HLS_RELAY_BUG`.

## References

[1]: ../scripts/stream-diagnostics/forensic.js "DZ HOOF forensic diagnostic engine"
[2]: ../scripts/stream-diagnostics/v4-matrix.js "DZ HOOF V4 same-environment matrix runner"
[3]: ../server/backend/src/services/upstream-proxy.ts "DZ HOOF upstream relay"
[4]: ../server/backend/src/services/upstream-proxy.test.ts "HLS URL resolution regression tests"
[5]: ../../upload/pasted_content.txt "User-provided DZ HOOF V4 investigation specification"
