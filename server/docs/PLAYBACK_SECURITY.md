# حماية تشغيل DZ HOOF

## الغرض ونموذج التهديد

يمنع هذا التصميم مشاركة قوائم البث أو إعادة استعمال رابط تشغيل على جهاز آخر، ويمنع استمرار التشغيل بعد انتهاء الاشتراك أو تعطيل الحساب. لا يجوز أن تظهر عناوين مزود البث الخام أو اعتمادات المصدر في استجابة عميل أو سجل تشخيصي.

> مسار التشغيل لا يثق في قرار سابق: يعيد فحص المستخدم، الاشتراك، الجهاز، وحالة القناة عند كل قرار حساس.

## المسار المعتمد

يطلب العميل رمز تشغيل قصير العمر من `POST /api/v1/tv/playback-token` ويرسل `channelId` و`slot` فقط، ومع catch-up يرسل `catchupStartMs` و`catchupDurationMin`. لا يرسل العميل رابط Xtream أو M3U إلى الخادم في هذا الطلب.

يعيد الخادم `data.playbackUrl` بالشكل `/api/v1/tv/playback/{token}`. رمز التشغيل مشفر بـ AES-256-GCM ولا يظهر عنوان المصدر بصيغته الخام. الافتراضي خمس دقائق، مع حدود من 30 ثانية إلى 15 دقيقة. يجب ضبط `PLAYBACK_TOKEN_SECRET` و`PLAYBACK_TOKEN_TTL_MS` في بيئة التشغيل فقط.

| الطبقة | آلية الحماية | نتيجة الفشل |
|---|---|---|
| هوية الجهاز | `X-Device-Token` عشوائي 256-bit يبدأ بـ`dzt_` | 401 |
| التخزين | SHA-256 للرمز فقط و`select:false` | لا يمكن استرداد الرمز من MongoDB |
| الاشتراك | فحص DB للمستخدم والحالة والخطة وتاريخ الانتهاء | 403 و`SUBSCRIPTION_EXPIRED` |
| رمز التشغيل | `pt2` يحمل `userId` و`deviceId` ووقت إصدار رمز الجهاز | 401/403 |
| قناة catalog | لا تعرض إلا عندما `lifecycleStatus=active` | لا تصل قناة غير مراجعة للعميل |

المستخدم النشط يحتاج اشتراكاً صالحاً وخطة `Active`. مدير النظام النشط يتجاوز شرط الاشتراك التجاري فقط؛ لا يتجاوز تعطيل الحساب. مسار `GET /api/v1/streams/authorize` للأفلام والمسلسلات والقنوات يستخدم مبدأ التفويض نفسه.

## Device access token والدوران

يصدر رمز الوصول عند تفعيل العميل أو بالدوران عبر endpoint مصادق عليه. تحفظ وثيقة `Device` فقط الحقول الآتية:

| الحقل | الاستخدام |
|---|---|
| `accessTokenHash` | SHA-256 للبحث والتحقق؛ لا يعاد في الاستجابات |
| `accessTokenIssuedAt` | يربط `pt2` بجيل الرمز الحالي |
| `accessTokenExpiresAt` | انتهاء صلاحية رمز الجهاز |
| `accessTokenRevokedAt` | إبطال فوري للدوران أو الإلغاء |

يرسل العميل القيمة في `X-Device-Token` فقط. لا توضع في query string أو analytics أو log. يحتفظ Android بالقيمة في `SecurePreferences` ويخفيها من interceptor logs. عند الدوران أو الإبطال يصبح `deviceTokenIssuedAt` في جميع رموز `pt2` القديمة غير مطابق وتُرفض فوراً.

## HLS وalternate streams

عندما يكون المصدر manifest من HLS، يعيد proxy كتابة روابط المقاطع وnested manifests إلى playback tokens جديدة **تورث** `deviceId` ووقت إصدار رمز الجهاز. لذلك لا يجوز للعميل استخراج أو تخزين upstream URL من محتوى M3U8، ولا يمكن نقل segment token إلى جهاز آخر.

## توافق channelListCode وpt1

رمز `channelListCode` القصير ليس اعتماداً مناسباً لجهاز محدد. لذلك يبقى التوافق القديم **مقفلاً افتراضياً**:

| المسار أو السلوك | شرط التوافق |
|---|---|
| `/tv/verify/:code` و`/tv/pair` و`/tv/epg/:code` | `ALLOW_LEGACY_TV_CODE=true` |
| `/tv/playlist/:code` وJSON المقابل | المتغيران `ALLOW_LEGACY_TV_CODE=true` و`ALLOW_LEGACY_PLAYBACK_TOKEN=true` |
| `/user-playlist/me/*` التي تصدر روابط v1 | `ALLOW_LEGACY_PLAYBACK_TOKEN=true` |
| قبول playback token `pt1` | `ALLOW_LEGACY_PLAYBACK_TOKEN=true` |

عند تعطيل التوافق تعيد الخدمة `410` و`LEGACY_TV_CODE_DISABLED` أو `LEGACY_PLAYBACK_TOKEN_DISABLED`. هذه استجابة مقصودة؛ يجب ترحيل العميل إلى التفعيل الرسمي وإرسال `X-Device-Token`، لا إعادة تمكين code القصير بشكل دائم.

المساران `/api/v1/tv/stream/:code?url=...` و`/api/v1/tv/proxy-url/:code?url=...` معطلان افتراضياً كذلك عبر `ALLOW_LEGACY_RAW_PROXY=false`. تصدير `/api/v1/channels/playlist.m3u` الخام معطل عبر `ALLOW_LEGACY_RAW_PLAYLIST=false`.

## متطلبات التشغيل والاستجابة للحوادث

استخدم HTTPS وسراً قوياً ومستقلاً لـ`PLAYBACK_TOKEN_SECRET`، ولا تسجل query strings أو رموز الاعتماد في reverse proxy. عند فقدان جهاز أو الاشتباه بتسريب رمز، أبطله أو دوّره؛ لا تعالج الحادثة بإظهار source URL أو بتمكين legacy.

قبل الإصدار، تحقق من قبول device token السليم ورفض المفقود أو المشوه أو المنتهي أو المبطل، ورفض المستخدم المعطل والاشتراك المنتهي، ورفض `pt1` والمسارات code عندما تكون الرايات `false`. اختبر HLS بمصدر قانوني يضم redirect وsegment URLs وnested manifests وfailover في staging.

لخطة الترحيل والإرجاع راجع [DEVICE_TOKEN_MIGRATION.md](./DEVICE_TOKEN_MIGRATION.md) و[RELEASE_RUNBOOK.md](./RELEASE_RUNBOOK.md).
