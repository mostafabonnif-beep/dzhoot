# ملاحظات البحث المعمق حول Xtream

## نتائج الاختبار المحلي

- `player_api.php` أعاد HTTP 200، و`user_info.auth=1`، والحساب Active.
- `get_live_streams` أعاد 16,609 سجلًا وقناة أولى `stream_id=262849`.
- رابط التشغيل القياسي `/live/{username}/{password}/{stream_id}.ts` أعاد HTTP 456 وحجم صفر من العنوانين.
- صيغ `.m3u8` وبدون امتداد و`/stream` و`/hls` لم تُرجع بيانات بث.
- `get.php` مع `output=ts` و`m3u8` و`hls` أعاد HTTP 884 وحجم صفر.

## المصادر المقروءة

1. Emby Community، موضوع Playback Error 456: فريق Emby ذكر أن المزود يرسل 456، وربطه عادة بتجاوز quota، وانتهى المثال بإعطاء المزود عنوانًا جديدًا يعمل.
   URL: https://emby.media/community/topic/134459/playback-error-456/
2. Stack Overflow، How to build a playable URL from Xtream Codes API?: الصيغة القياسية تستخدم `stream_id` في `/live/USER/PASS/STREAM_ID.ts`.
   URL: https://stackoverflow.com/questions/78847811/how-to-build-a-playable-url-from-xtream-codes-api

## الفرضيات التي تستحق الاختبار المشروع

- حصة أو حد اتصالات/أجهزة على الحساب.
- تقييد عنوان IP أو المنطقة الجغرافية.
- تقييد User-Agent أو Referrer أو نوع الإخراج.
- الحساب يسمح بواجهة API لكنه لا يسمح بالبث المباشر.
- الرابط المقدم هو portal/API endpoint مختلف عن endpoint البث.

لا يجوز تجاوز حماية المزود أو التحايل على حدود الحساب. الحل المقبول هو اختبار الترويسات والصيغ القياسية، أو طلب تفعيل Live Playback/عنوان جديد من المزود، أو استخدام مصدر مصرح يعمل فعليًا.

## متابعة البحث

3. نقاش Fermata على GitHub يبيّن أن تطبيقات Xtream تتعامل مع API عبر `player_api.php` لجلب live streams وcategories، بينما تنزيل M3U مسار منفصل. هذا يدعم أن HTTP 884 قد يكون قفلًا أو رفضًا لمسار M3U ولا يثبت وحده أن API أو playback يعمل.
   URL: https://github.com/AndreyPavlenko/Fermata/discussions/434

4. بحث المجتمع حول 884 يكرر احتمال أن مزود الخدمة يقفل M3U أو يقيّده بالمنطقة/العميل؛ هذه نتائج مجتمعية غير رسمية وتحتاج تأكيدًا من المزود، وليست توثيقًا رسميًا.

الاستنتاج المرحلي: من الناحية البرمجية يمكن استخدام `player_api.php` لجلب metadata ثم بناء رابط التشغيل القياسي، لكن اختبارنا الفعلي لهذا الرابط أعاد 456 في صيغ TS وM3U8. لذلك يبقى الاختناق في تسليم البث أو سياسة الحساب، لا في بناء الرابط داخل تطبيق DZ HOOF.

## قيود إضافية مؤكدة من البحث

5. مرجع أنماط Xtream المجتمعي يذكر صيغة live القياسية `/live/{username}/{password}/{stream_id}.{extension}`، ويفرق بين `.ts` و`.m3u8`. كما يذكر قيود GeoIP وISP Lock وIP Whitelist وUA Whitelist وMax Connections وFlood Protection. هذه وثيقة مجتمعية وليست مواصفة رسمية حالية.
   URL: https://github.com/worldofiptvcom/xtream-codes-api-documentation/blob/master/IPTV_PATTERNS_AND_INTEGRATIONS.md

النتيجة العملية: تطبيق DZ HOOF يستطيع تجربة User-Agent مناسب، وإدارة timeout/retry، واستخدام endpoint القياسي أو proxy آمن. لكنه لا يستطيع إنشاء bytes للبث إذا كان المزود يعيد 456/513/403 من كل مسارات التشغيل. HTTP 884 يخص تنزيل M3U في نتائج البحث المجتمعية، بينما HTTP 456 ظهر مباشرة من endpoint live في الاختبار، وهذا فصل مهم بين مشكلتي M3U وLive Playback.
