# تقييم مشاريع Media Server لدمجها مع DZ HOOF

**التاريخ:** 16 أغسطس 2026

## النتيجة التنفيذية

تمت مقارنة مشاريع مفتوحة المصدر يمكن أن تضيف طبقة media origin أو proxy أو transcoding إلى DZ HOOF. النتيجة المهنية هي أن **MediaMTX هو الخيار الأنسب كطبقة media router خفيفة** بعد الحصول على مصدر upstream صالح ومصرح به. أما SRS وOvenMediaEngine فهما مناسبان عندما يكبر حجم التوزيع أو نحتاج WebRTC/LL-HLS/ABR/DRM على مستوى متقدم. Threadfin وxTeVe مفيدان لأنظمة Plex/Emby/Jellyfin، لكنهما ليسا بديلاً مناسباً لـ Backend Express المخصص في DZ HOOF.

> لا يستطيع أي مشروع من هذه المشاريع إصلاح حساب يعيد `HTTP 456` أو `HTTP 884` مع حجم صفر؛ جميعها تحتاج bytes أو بروتوكول ingest صالحاً من upstream.

## مصفوفة المقارنة

| المشروع | ما يضيفه | ملاءمته لـ DZ HOOF | هل يحل الحساب الحالي؟ | القرار |
|---|---|---|---:|---|
| **MediaMTX** | Proxy وorigin وتحويل بين HLS وMPEG-TS وRTSP وRTMP وSRT وWebRTC وLL-HLS، مع on-demand paths | عالية كطبقة media-router خفيفة خلف Backend | لا | الخيار الأول بعد موافقة المزود ومصدر صالح |
| **SRS** | RTMP وWebRTC وHLS وHTTP-FLV وHTTP-TS وSRT وDASH وtranscoding ومزايا clustering | عالية عند التوسع والبث المباشر متعدد البروتوكولات | لا | خيار مرحلة التوسع أو RTMP-heavy |
| **OvenMediaEngine** | LL-HLS وWebRTC وABR وDVR وDRM وorigin-edge وREST API | عالية للمستوى الاحترافي المتقدم | لا | مناسب بعد ثبات المصدر وظهور الحاجة إلى LL-HLS/DRM |
| **Threadfin** | M3U/XMLTV proxy وتصفية ومطابقة القنوات وEPG وإعادة البث لأنظمة Plex/Emby/Jellyfin | متوسطة إلى منخفضة لأن DZ HOOF يملك middleware مخصصاً | لا | لا ندمجه الآن؛ نستخدم أفكاره فقط عند الحاجة |
| **xTeVe** | M3U/XMLTV proxy لأنظمة Plex/Emby | منخفضة لنفس السبب | لا | لا يضيف قيمة كافية فوق Backend الحالي |
| **FFmpeg** | عامل relay/transcode/remux وليس middleware مستقلاً | عالية كعامل خلف MediaMTX عند وجود source صالح | لا | يُشغل في خدمة media-router منفصلة، لا داخل API بلا حاجة |

## البنية المقترحة

يجب فصل **control plane** عن **media plane**. يبقى DZ HOOF مسؤولاً عن كود التفعيل، الاشتراك، الكتالوج، playback tokens، القيود وعدد الأجهزة. وتكون MediaMTX أو SRS طبقة مستقلة تستقبل stream صالحاً من مزود مرخص، ثم تقدم HLS أو LL-HLS أو MPEG-TS للعملاء. عند استخدام FFmpeg، يبدأ worker relay فقط بعد اجتياز التحقق ووجود إثبات ترخيص وبيانات اتصال صادرة من المزود.

```text
Provider B2B / licensed origin
          |
          |  HLS / TS / RTMP / RTSP / SRT — bytes must exist
          v
Authorized relay worker (FFmpeg, optional)
          |
          v
MediaMTX origin/edge router
          |
          |  HLS / LL-HLS / WebRTC / MPEG-TS
          v
DZ HOOF Backend: tokens, catalog, activation, access control
          |
          v
Android / Android TV customer app
```

هذه البنية لا تعني أن MediaMTX يستخرج البث من Xtream metadata. هي فقط تجعل التوزيع أكثر كفاءة بعد أن يسلّم المزود مصدراً قابلاً للقراءة. وتوضح وثائق MediaMTX أن proxy يمرر طلبات إلى خادم أو كاميرا أخرى، وأن FFmpeg ينشر إلى MediaMTX عبر RTSP أو RTMP أو SRT أو MPEG-TS [1] [2].

## سبب عدم دمج MediaMTX مباشرة في هذه اللحظة

المصدر الحالي يثبت نجاح `player_api.php` ويعيد 16,609 قناة في metadata، لكن `server_info` يعلن `http` على المنفذ 80 و`rtmp_port=8001`، بينما أعاد M3U HTTP 884، وLive HLS وTS HTTP 456، وفشل RTMP handshake. لذلك لا توجد إشارة يمكن تسليمها إلى MediaMTX أو FFmpeg.

إدخال MediaMTX الآن سيضيف خدمة وذاكرة ومنافذ ومراقبة دون أن يغير نتيجة المصدر. الأسلوب الصحيح هو تجهيز التكامل كمرحلة اختيارية، ثم تفعيله عندما يرسل المزود رابط قناة اختبار صالحاً أو يضيف IP الخاص بـ VPS إلى whitelist.

## ما تم تحسينه داخل DZ HOOF

تم توسيع Xtream diagnostics لتسجيل `server_info`، بما في ذلك protocol وport وhttpsPort وrtmpPort. كما أصبح النظام يجرب `m3u8` ثم `ts`، ويحفظ `playbackFormat` الذي نجح فعلياً، ويستخدمه في روابط الكتالوج وpreview وsync. يظل المصدر محجوباً إذا نجحت metadata فقط ولم ينجح Live Playback.

هذا التحسين يغطّي حالة مزود شرعي يدعم TS فقط أو HLS فقط. أما أخطاء 456/884 الحالية فلا تتغير لأنها صادرة من طبقة المزود قبل وصول أي bytes إلى مشروعنا.

## ترتيب التنفيذ المقترح عند توفر VPS وحساب مصرح

أولاً، نثبت MediaMTX كخدمة منفصلة على شبكة Docker داخلية، ولا نعرض control API للعامة. ثانياً، نضيف relay worker محدوداً بمصادر موثقة، مع healthcheck وrestart policy وقيود CPU والذاكرة. ثالثاً، يختبر Backend القناة الأصلية من نفس عنوان VPS، ثم يكتب نتيجة diagnostics ويقرر الصيغة. رابعاً، يشغل relay للقنوات التي اجتازت التحقق فقط، ويجعل MediaMTX يقدم HLS أو LL-HLS بعنوان داخلي. خامساً، يبقى Android متصلاً بخدمة DZ HOOF ولا يرى بيانات اعتماد المزود.

## ما يحتاجه المستخدم من المزود

نحتاج حساب B2B أو reseller ينص صراحةً على server-side restreaming إلى تطبيق DZ HOOF، عنوان VPS ثابت لإضافته إلى IP whitelist عند الحاجة، حد اتصالات مناسب للاختبار والإنتاج، رابط قناة اختبار واحدة، وبيانات رسمية عن الصيغة المطلوبة وUser-Agent أو headers إن وجدت. كما نحتاج وثيقة حقوق إعادة البث للبلدان المستهدفة وEPG والشعارات.

## المراجع

[1] [MediaMTX — Proxy requests](https://mediamtx.org/docs/features/proxy)

[2] [MediaMTX — FFmpeg publishing](https://mediamtx.org/docs/publish/ffmpeg)

[3] [MediaMTX — GitHub repository](https://github.com/bluenviron/mediamtx)

[4] [SRS — GitHub repository](https://github.com/ossrs/srs)

[5] [OvenMediaEngine — GitHub repository](https://github.com/OvenMediaLabs/OvenMediaEngine)

[6] [Threadfin — GitHub repository](https://github.com/Threadfin/Threadfin)

[7] [iptv-org — publicly available IPTV collection](https://github.com/iptv-org/iptv)
