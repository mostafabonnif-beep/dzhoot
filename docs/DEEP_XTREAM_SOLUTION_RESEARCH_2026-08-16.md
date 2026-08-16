# بحث تقني معمق عن حل عرض قنوات Xtream في DZ HOOF

**التاريخ:** 16 أغسطس 2026
**المشروع:** DZ HOOF
**النطاق:** حلول قانونية ومصرح بها لتحويل مصدر Xtream صالح إلى كتالوج وتشغيل داخل Android/Android TV

## الملخص التنفيذي

نجاح `player_api.php` يثبت أن الحساب يسمح بقراءة metadata، لكنه لا يثبت أن طبقة الفيديو متاحة. في الحساب الذي تم اختباره، أعاد API حالة `auth=1` و`Active` مع 16,609 قناة، بينما أعاد M3U حالة `HTTP 884` بحجم صفر، وأعادت مسارات Live بصيغتي HLS وTS حالة `HTTP 456` بحجم صفر. كما فشل RTMP على المنفذ الذي أعلنه `server_info`.

> **الخلاصة التقنية:** لا توجد إضافة relay أو Media Server تستطيع إنتاج bytes فيديو من استجابة upstream حجمها صفر. الإضافات تستطيع إعادة تغليف أو تحويل stream موجود، لكنها لا تستبدل صلاحية الحساب أو whitelist أو سياسة المزود.

## ما تم التحقق منه

| طبقة الاختبار | النتيجة | التفسير |
|---|---:|---|
| `player_api.php` | ناجح | metadata والمصادقة متاحان |
| `get_live_streams` | 16,609 قناة | قائمة أسماء وIDs فقط |
| `direct_source` | 0 قناة | لا يوجد رابط مباشر رسمي بديل |
| M3U `m3u/ts` | 884، صفر bytes | مسار M3U مرفوض |
| M3U `m3u/hls` | 884، صفر bytes | تغيير output لا يغير القرار |
| M3U `m3u/m3u8` | 884، صفر bytes | تغيير output لا يغير القرار |
| M3U `m3u_plus/ts` | 884، صفر bytes | مسار M3U Plus مرفوض |
| Live HLS | 456، صفر bytes | لا توجد استجابة فيديو |
| Live TS | 456، صفر bytes | لا توجد استجابة فيديو |
| RTMP 8001 | فشل handshake | لا يوجد ingest صالح من الحساب |

اختُبرت عينة من قنوات تحمل أسماء جزائرية وفرنسية ورياضية، ثم اختُبرت العينة القياسية التي يستخدمها النظام؛ الرفض كان شاملاً للعينة وليس مرتبطاً بقناة واحدة.

## تقييم الحلول والمشاريع

| الحل | ما يفعله فعلياً | هل يحل هذا الحساب؟ | قرار الدمج |
|---|---|---:|---|
| مكتبة `@iptv/xtream-api` | parsing وserialization وgenerateStreamUrl لمسارات Xtream القياسية | لا | لا تُضاف؛ DZ HOOF يملك تكاملاً كافياً |
| `direct_source` الرسمي | يستخدم رابطاً يرسله المزود لكل قناة، بعد فحص Live | غير متاح؛ 0 من 16,609 | أُضيف إلى Backend كتحسين آمن |
| FFmpeg relay/remux | يقرأ upstream صالحاً ويعيد تغليفه إلى TS/HLS | لا | يُستخدم لاحقاً بعد موافقة المزود |
| MediaMTX | proxy/origin وHLS وMPEG-TS وRTSP وRTMP وSRT وWebRTC | لا | الخيار الأول بعد وصول bytes صالحة |
| SRS | media server واسع للتوسع وRTMP/WebRTC/HLS | لا | خيار توسع لاحق |
| OvenMediaEngine | LL-HLS وWebRTC وABR وDVR وDRM | لا | لا حاجة له قبل ثبات المصدر |
| Threadfin/xTeVe | M3U/XMLTV middleware لأنظمة Plex/Emby/Jellyfin | لا | لا يضيف قيمة فوق Backend الحالي |
| `node-ffmpeg-mpegts-proxy` | proxy قديم يحول مصدر HLS قابل للقراءة إلى MPEG-TS | لا | لا يُدمج؛ قديم ولا يعالج 456/884 |

توضح وثائق MediaMTX أن proxy يمرر الطلبات إلى خادم أو كاميرا أخرى، وأن FFmpeg ينشر stream إلى MediaMTX؛ كلاهما يفترض وجود مصدر قابل للقراءة [1] [2]. وتوضح مكتبة Xtream الرسمية أنها تبني روابط القنوات من `streamId` والامتداد ولا تضيف طبقة نقل جديدة [3] [4].

## ما تم دمجه في DZ HOOF

أضيف دعم `direct_source` الرسمي داخل `xtream-service.ts`. عند وجود رابط مباشر من المزود، يجربه النظام أولاً، ولا يكتبه في الكتالوج إلا بعد نجاح Live Playback. عند فشله يعود النظام إلى m3u8 ثم TS. أضيف اختبار end-to-end لهذا السيناريو.

كما تم تثبيت تشخيص `server_info`، وحفظ البروتوكول والمنافذ، وإبقاء بوابة المزامنة مغلقة للمصدر الذي ينجح في metadata فقط. هذا يمنع عرض أسماء قنوات لا يمكن تشغيلها للعميل.

## تفسير شاشة التطبيق

الشاشة التي تعرض `تم التحقق من 3/3` لا تعني أن 16,609 قناة Xtream فُحصت. هي تعني أن الكتالوج الحالي يحتوي ثلاث قنوات تجريبية من `iptv-org`، ولذلك يظهر `1AlmereTV`. endpoint الذي يستخدمه Android فعلياً، وهو `/api/v1/channels`، أعاد هذه القنوات الثلاث فقط؛ لم تدخل قنوات Xtream إلى الكتالوج لأن المصدر لم ينجح في Live Playback.

## النتيجة والحل الحاسم

لا يوجد تغيير داخل Android أو Express أو MediaMTX يستطيع تحويل `HTTP 456` و`HTTP 884` بحجم صفر إلى فيديو. الحل الحاسم يجب أن يأتي من المزود: حساب B2B/Reseller يسمح بإعادة البث، أو whitelist لعنوان VPS، أو رابط قناة اختبار صالح من نفس الخادم، أو `direct_source` رسمي قابل للقراءة. بعد توفر ذلك، تكون البنية المناسبة:

```text
Provider B2B / licensed origin
        -> optional FFmpeg relay
        -> MediaMTX origin
        -> DZ HOOF tokens and catalog
        -> Android / Android TV
```

قبل VPS يجب تثبيت `XTREAM_SECRET_KEY` في secret manager أو `.env` الإنتاجي وعدم تغييره، لأن تغييره يجعل credentials المشفرة غير قابلة للفك بعد إعادة تشغيل الخدمة.

## حالة الاختبارات والدفع

| الفحص | الحالة |
|---|---:|
| Typecheck | ناجح |
| اختبارات Xtream | 9/9 ناجحة |
| اختبارات Backend | 189/189 ناجحة |
| دعم direct_source | مدمج ومختبر |
| آخر commit برمجي | `0e12da9` |
| آخر commit توثيقي | `46a4d63` |

## المراجع

[1]: https://mediamtx.org/docs/features/proxy "MediaMTX — Proxy requests"

[2]: https://mediamtx.org/docs/publish/ffmpeg "MediaMTX — FFmpeg publishing"

[3]: https://github.com/ektotv/xtream-api "ektotv/xtream-api — TypeScript Xtream API library"

[4]: https://www.npmjs.com/package/@iptv/xtream-api "@iptv/xtream-api — npm package"

[5]: https://github.com/AndreyPavlenko/Fermata/discussions/434 "Fermata — Xtream Code API implementation discussion"
