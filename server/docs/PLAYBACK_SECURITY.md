# حماية تشغيل DZ HOOT

## المسار الجديد

يطلب العميل token تشغيل قصير العمر من `POST /api/v1/tv/playback-token`، ويرسل `channelId` و`slot` فقط. في وضع catch-up يرسل أيضاً `catchupStartMs` و`catchupDurationMin`. لا يرسل العميل رابط Xtream أو M3U إلى الخادم في هذا الطلب.

يعيد الخادم `data.playbackUrl` بالشكل `/api/v1/tv/playback/{token}`. التوكن مشفر بـ AES-256-GCM، ولا يحتوي النص الظاهر منه على رابط المصدر. الافتراضي خمس دقائق، وتُفرض حدود من 30 ثانية إلى 15 دقيقة. يمكن ضبط `PLAYBACK_TOKEN_SECRET` و`PLAYBACK_TOKEN_TTL_MS` في بيئة التشغيل.

مسار `GET /api/v1/streams/authorize` الخاص بالأفلام والمسلسلات والقنوات يعيد نفس نوع playback URL بعد التحقق من الاشتراك، الجهاز، وملكية القناة عند الحاجة.

## HLS وalternate streams

عندما يكون المصدر Manifest من نوع HLS، يعيد proxy كتابة روابط المقاطع والـ nested manifests إلى playback tokens جديدة. لذلك لا يجب على العميل استخراج أو تخزين upstream URL من محتوى M3U8.

## المسارات القديمة

المساران `/api/v1/tv/stream/:code?url=...` و`/api/v1/tv/proxy-url/:code?url=...` معطلان افتراضياً ويعيدان `410`. يمكن فتحهما مؤقتاً عبر `ALLOW_LEGACY_RAW_PROXY=true` أثناء ترحيل عميل قديم فقط، ثم يجب إعادة القيمة إلى `false` وإعادة تشغيل الخادم.

تصدير `/api/v1/channels/playlist.m3u` العام الخام معطل افتراضياً عبر `ALLOW_LEGACY_RAW_PLAYLIST=false`. قوائم المستخدم وTV وJWT تستخدم playback URLs بدلاً من upstream URLs. يجب ضبط `PUBLIC_BASE_URL` على عنوان HTTPS العام عند استخدام reverse proxy.

## إلغاء الصلاحية

يتحقق proxy في كل طلب من أن المستخدم ما زال نشطاً وأن `channelListCode` ما زال مطابقاً. إلغاء المستخدم أو تغيير رمز القناة يلغي صلاحية التوكنات السابقة عملياً حتى قبل انتهاء TTL.

## متطلبات التشغيل

يجب استخدام HTTPS، وقيمة عشوائية قوية ومستقلة لـ `PLAYBACK_TOKEN_SECRET`، وعدم تسجيل query strings أو التوكنات في reverse proxy. يجب أيضاً اختبار HLS بمصدر يضم redirect وsegment URLs وقياس buffering وfailover في staging قبل توسيع قاعدة العملاء.
