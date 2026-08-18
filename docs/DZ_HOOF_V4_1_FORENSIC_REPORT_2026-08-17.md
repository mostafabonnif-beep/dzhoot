# DZ HOOF V4.1 — Diagnostic Matrix Update

## Executive Result

تم تنفيذ V4.1 على **بيئة التنفيذ الحالية** فقط. لم تتوفر بيانات SSH أو اتصال مباشر إلى VPS الإنتاجي الذي سيستضيف `ld-11.net`، ولذلك لم يتم تقديم نتيجة sandbox على أنها نتيجة VPS.

> **Primary classification: E — INCONSISTENT_OR_INSUFFICIENT_EVIDENCE**

السبب ليس أن الأدلة تثبت حظراً من المزود؛ بل لأن نتائج المسارات المباشرة متغيرة بين المحاولات، ولأن الاختبار الحاسم من VPS الإنتاجي لم يُنفذ. في إحدى محاولات V4.1 أعاد `curl_native` HTTP 200 مع HTML و0 bytes، بينما أعاد `curl_vlc_profile` HTTP 403 مع HTML و18 bytes. في محاولة أخرى انعكست الحالات جزئياً. لم يثبت أي مسار valid media.

## What Already Existed Before V4.1

كان الفرع يحتوي على secure playback tokens وsubscription authorization وserver-side upstream resolution وHLS relay وURL rewriting وcredential redaction وforensic diagnostics وV4 runner السابق. كما كانت اختبارات stream health/session وrelay URL resolution موجودة، والفرع هو `feature/v4-same-vps-stream-forensics` عند commit `3783bdf` قبل تعديلات V4.1.

لم يتم تعديل secure playback أو subscription authorization أو provider authentication أو relay architecture، ولم تتم إضافة cache أو proxy rotation أو bypass أو fingerprint spoofing.

## V4.1 Matrix

| الاختبار | السلوك المطلوب | نتيجة بيئة التنفيذ الحالية |
|---|---|---|
| `CURL_NATIVE` | curl default User-Agent، follow redirects، status/content type/bytes/TTFB/total/final URL | HTTP 200 أو 403 بصورة متغيرة، HTML، 0–18 bytes، بلا media |
| `CURL_VLC_PROFILE` | VLC-compatible User-Agent، `Accept: */*`، compressed، follow redirects | HTTP 200 أو 403 بصورة متغيرة، HTML، 0–18 bytes، بلا media |
| `FFPROBE` | format/codec/streams مع تصنيف النتيجة | exit code 1، لا format ولا streams، `invalid_media` |
| `VLC` | headless cvlc واكتشاف media فعلي | لم يثبت media؛ النتيجة `media_playback_failed` أو timeout |
| DZ HOOF forensic | redirect وHTML/bytes وprofiles | redirect 302 ثم HTML/0 bytes في الاختبارات السابقة |
| DZ HOOF relay على VPS الإنتاجي | المقارنة الحاسمة | **NOT TESTED** |

لم يتم اعتبار HTTP 200 نجاحاً؛ النجاح يتطلب valid HLS/MPEG-TS bytes واكتشاف format أو stream فعلي.

## Changes in V4.1

تم تعديل [`scripts/stream-diagnostics/v4-matrix.js`](../scripts/stream-diagnostics/v4-matrix.js) بأقل نطاق لإضافة `curl_native` مستقل عن VLC، مع إبقاء `curl_vlc_profile` كسلوك المقارنة السابق. أضيف تصنيف FFprobe إلى `valid_media` و`html_response` و`connection_failure` و`connection_timeout` و`invalid_media`. أضيف تصنيف VLC إلى `media_detected` و`missing_dependency` و`media_playback_timeout` و`media_playback_failed` و`process_started_no_media`.

تم أيضاً تشديد redaction للـraw artifacts وإخفاء signed `data` و`expires` parameters، مع فرض directory بصلاحية `0700` وملفات artifacts بصلاحية `0600`. لم يتم تعديل التطبيق أو cache أو HLS relay في V4.1.

## Security Verification

لم تُطبع credentials أو passwords أو access tokens أو JWTs أو cookies أو signed URLs في summary أو التقرير. لم تُحفظ ملفات M3U أو logs الخام داخل Git. لم يُنفذ bypass لأي Cloudflare أو WAF أو CAPTCHA أو IP restriction، ولم تُستخدم proxy/VPN/IP rotation أو cookies من جهاز المستخدم.

## Tests

| الأمر | النتيجة |
|---|---:|
| `node --check scripts/stream-diagnostics/v4-matrix.js` | PASS |
| V4.1 matrix على M3U snapshot | PASS كأداة؛ النتيجة الإعلامية: لا valid media |
| secret scan على summary | PASS؛ لا أسرار معروفة أو signed parameters مكشوفة |
| artifacts directory | `0700` |
| artifacts files | `0600` |
| `node --check scripts/stream-diagnostics/v4-matrix.js` | PASS |
| `npm run typecheck` داخل `server/backend` | PASS |
| `npm test -- --runInBand --silent` داخل `server/backend` | 27 suites، 200 tests PASS |
| `npm test -- --runInBand --silent` داخل `server/frontend` | 2 suites، 5 tests PASS |
| same-VPS production execution | **NOT TESTED** |

## Final Decision

لا يمكن اختيار Case A أو B أو C أو D بثقة من بيئة التطوير. التصنيف الصحيح حالياً هو **E — INCONSISTENT_OR_INSUFFICIENT_EVIDENCE**. الخطوة الوحيدة التي تحسم التحقيق هي تشغيل نفس runner على VPS الإنتاجي نفسه، باستخدام source محفوظ في secrets أو environment variables، ثم مقارنة `CURL_NATIVE` و`CURL_VLC_PROFILE` وFFprobe وVLC وDZ HOOF من نفس عنوان egress.

إذا نجحت FFprobe أو VLC على VPS وفشل DZ HOOF، عندها فقط يسمح الدليل بتحقيق HTTP differential داخل التطبيق. إذا فشلت الأدوات المستقلة أيضاً، يجب إيقاف تعديل التطبيق وتصنيف السبب الخارجي بعد تحديد هل هو authorization أو network policy أو upstream failure.

## References

[1]: ../scripts/stream-diagnostics/v4-matrix.js "V4.1 same-environment matrix runner"
[2]: ../scripts/stream-diagnostics/forensic.js "DZ HOOF forensic diagnostics"
[3]: ../server/backend/src/services/upstream-proxy.ts "DZ HOOF upstream relay"
[4]: ../../upload/pasted_content.txt "User-provided V4.1 investigation specification"
