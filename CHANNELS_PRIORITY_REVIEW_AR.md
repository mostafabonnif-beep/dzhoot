# تقرير إعادة الفحص والمقارنة — أولويات القنوات التلفزيونية في DZ HOOF

**التاريخ:** 15 أغسطس 2026

**النطاق:** القنوات التلفزيونية وLive TV فقط، مع الالتزام بالمصادر التي يملك المشغل حق استخدامها. لا يوفر DZ HOOF قوائم أو قنوات جاهزة، ولا تهدف هذه المقارنة إلى تجاوز حقوق البث أو حماية المزودين.

## 1. الملخص التنفيذي

تم تنفيذ الجولة ذات الأولوية الأعلى بعد المقارنة السابقة. ركزت الجولة على تحويل DZ HOOF من منصة تملك وظائف منفصلة للصحة والمصادر إلى **Control Plane للقنوات** يربط القناة المنطقية بمصادرها، ويتيح مراقبة EPG والصحة، ويحسن Failover، ويمرر البيانات التشغيلية إلى Android TV دون كسر offline-first أو إضافة Room migration.

النتيجة الحالية قوية في طبقة الخادم: أصبح للمشروع Channel Identity آمن، وSource Mapping لمصادر M3U وXtream، وreconciliation تلقائي بعد المزامنة، وendpoint إداري موحد، وFailover يحافظ على رؤوس المصدر داخل playback token مشفر. كما أصبح Android قادرًا على استقبال health وidentity في ذاكرة مؤقتة وعرض Availability Score على بطاقة القناة. تبقى الفجوة الكبرى هي أن بعض هذه القدرات لا تزال advisory في التطبيق وليست سياسة ترتيب كاملة، كما أن معاينة المزامنة وrollback وقياس QoE الكامل لم تُنجز بعد.

> **الحكم المهني:** DZ HOOF تجاوز مرحلة مشغل M3U تقليدي، لكنه لم يصل بعد إلى تكافؤ كامل مع أفضل منتجات Live TV في التسجيل المركزي، إدارة المجموعات المتقدمة، معاينة المزامنة، وقياس تجربة المشاهدة. نقطة التفوق الواقعية الآن هي الجمع بين خادم قانوني متعدد المصادر، وFailover قابل للتفسير، وواجهة Android TV عربية.

## 2. ما تم تنفيذه في جولة الأولويات

| الأولوية | التنفيذ الفعلي | الأثر على المنتج |
|---|---|---|
| Channel Identity | إضافة `ChannelIdentity`، ومفتاح منطقي مبني على tvg-id الحقيقي، ودرجات ثقة، وربط القنوات من M3U وXtream. أسماء القنوات وحدها لا تُدمج تلقائيًا إذا لم يوجد بلد أو معرف موثوق. | تقليل تكرار القناة نفسها عبر المصادر ومنع الدمج الخاطئ للقنوات المتشابهة. |
| Source Mapping | حفظ `m3uSourceId` في metadata المشتركة، وربط source references وإحصاء عدد المصادر لكل هوية. | أساس قابل للتوسع لاختيار مصدر مفضل لكل قناة لاحقًا. |
| Reconciliation | تشغيل reconciliation بعد مزامنة M3U وXtream، مع endpoint إداري يدوي `POST /api/v1/admin/channel-identities/reconcile`. | تحديث الهوية تلقائيًا بعد كل مزامنة وإتاحة إصلاح يدوي للمشرف. |
| Failover | حفظ `activeUserAgent` و`activeReferrer` عند ترقية البديل، وتمريرهما داخل playback token المشفر إلى proxy، مع رفض CRLF وحدود طول الرؤوس. | تحسين تشغيل المصادر التي تحتاج رؤوسًا مخصصة وتقليل فشل البديل بعد promotion دون كشفها للعميل. |
| Control Plane | توسيع `GET /api/v1/admin/stats/channel-operations` ليشمل `identities` وEPG والصحة والمصادر. | رؤية تشغيلية موحدة للمشرف بدل شاشات متفرقة. |
| Android TV | تمرير health وidentity عبر transient cache من DTO إلى Domain وUI، وعرض Availability Score اختياريًا على ChannelCard دون Room migration. | وصول المؤشر إلى تجربة التلفاز مع الحفاظ على توافق قاعدة البيانات المحلية. |
| التوثيق | تحديث خارطة الطريق وعقد `docs/CHANNEL_OPERATIONS_API.md` وإضافة مقارنة السوق. | تقليل الغموض بين Backend وFrontend وAndroid وتمهيد اختبارات التكامل. |

## 3. المقارنة المحدثة مع المنتجات والخوادم المنافسة

تختلف المنافسة بين مشغلات Android TV وخوادم Live TV. يعلن TiviMate أنه مشغل لا يوفر المحتوى، ويركز على تجربة التلفاز وEPG وCatch-up والتسجيل والتخصيص؛ بينما يركز Sparkle TV على تعدد المصادر وDVR وTimeshift وXMLTV وMultiview. [1] [2] OTT Navigator يبرز أهمية إعادة تحميل EPG وإظهار نتائج كل مصدر ومطابقة القنوات بالاسم أو tvg-id. [3]

| المحور | DZ HOOF بعد الجولة | TiviMate / Sparkle / OTT Navigator | Tvheadend / Jellyfin | الحكم والفجوة المتبقية |
|---|---|---|---|---|
| مصادر القنوات | M3U وXtream ومصادر إضافية، مع تشفير أسرار وSSRF guard ومزامنة وحالة مصدر. | توقعات قوية في تعدد القوائم والاستيراد وسهولة تبديل المصدر. [1] [2] [3] | إدارة Tuners وM3U وموارد Live TV مركزية. [6] [7] | DZ HOOF أقوى خادميًا في الاشتراك والتفويض، لكنه يحتاج Source Priority وPreview قبل التطبيق. |
| هوية القناة | `ChannelIdentity` منفصل منطقيًا عن `channelId` المصدر، مع tvg-id وثقة ومصادر متعددة. | OTT Navigator يوضح أهمية مطابقة الاسم وtvg-id. [3] | الخوادم تحتاج فصل القناة المنطقية عن الخدمة/المصدر. [6] [7] | تحسن جوهري؛ المطلوب التالي واجهة مراجعة ودمج يدوي للقنوات منخفضة الثقة. |
| EPG | XMLTV، Catch-up، بحث برامج، freshness وإحصاءات أخطاء ومصادر. | EPG غني وتجارب إعداد وإعادة تحميل واضحة. [1] [2] [3] | فلاتر ودليل مركزي وقواعد تسجيل في Tvheadend، وإضافة tuner/guide في Jellyfin. [6] [7] | DZ HOOF يحتاج unmatched channels وcoverage per source وفلترة Guide حسب المجموعة واللغة. |
| الصحة وFailover | Availability Score، primary/fallback، scheduler، promotion، حفظ رؤوس المصدر داخل توكن مشفر. | بعض المشغلات تعيد المحاولة أو تدعم مصادر متعددة، لكن التشخيص عادة محدود للمستخدم. [1] [2] [3] | الخادم يسمح بسيطرة أكبر على المصدر والتسجيل والجدولة. [6] [7] | هذه أقوى نقطة تفوق محتملة؛ يلزم إضافة hysteresis وقرار قابل للشرح وQoE حقيقي. |
| تجربة الريموت وzapping | Previous/Next وMultiview وhealth dot وscore في البطاقة وRTL أساسي. | نضج كبير في TV focus والتخصيص والاختصارات. [1] [2] [5] | ليست الأولوية الأساسية للخوادم. [6] [7] | يجب اختبار جهاز TV فعلي، وتحسين سرعة بدء القناة، والعودة لآخر قناة، ومجموعات Favorites. |
| التسجيل وDVR | غير مكتمل كمنتج مركزي. | Sparkle وTiviMate يقدمان وظائف تسجيل حسب الإصدار والجهاز. [1] [2] | Tvheadend يملك قواعد تسجيل تلقائي، وJellyfin يركز على Live TV والتسجيل ضمن بيئته. [6] [7] | DVR يبقى P2 لأنه يحتاج تخزينًا وسياسة احتفاظ وحقوق واضحة. |
| القياس والدعم | Stream metrics وصحة المصدر وبعض مؤشرات EPG موجودة. | غالبًا لا تظهر للمستخدم مؤشرات QoE خادمية عميقة. | الخوادم توفر سجلات تشغيل أكثر من المشغلات. | يلزم telemetry مجهول لـstartup وrebuffer وfallback success حسب القناة. |

## 4. نتائج إعادة الفحص التقني

| الفحص | النتيجة |
|---|---|
| Backend typecheck | ناجح. |
| Backend lint | ناجح، مع warnings قديمة موجودة في المشروع ولا توجد أخطاء جديدة تمنع lint. |
| Backend tests | **22 suite و169 اختبارًا ناجحة**. تشمل Channel Identity وControl Plane وFailover وplayback token. |
| Full workspace build | ناجح لـshared وbackend وfrontend. |
| Frontend lint | ناجح. |
| Frontend tests | **مجموعتان و5 اختبارات ناجحة**. |
| Frontend production build | ناجح، مع توليد 39 route. |
| Android local compile | تعذر بسبب عدم وجود Android SDK في البيئة؛ الخطأ بيئي واضح في `android/local.properties` وليس نتيجة Kotlin مؤكدة. يجب الاعتماد على CI أو Emulator فعلي للتحقق النهائي. |
| Security review | روابط البث والأسرار لا تدخل في health أو identity أو Control Plane، وheaders الخاصة بالمصدر داخل token مشفر مع حماية CRLF. |

## 5. التقييم مقابل المنافسة

| البعد | مستوى DZ HOOF الحالي | التقدير |
|---|---:|---|
| إدارة المصادر والخادم | 8/10 | أعلى من مشغل محلي تقليدي بفضل M3U وXtream والصلاحيات والمزامنة. |
| هوية القناة وتعدد المصادر | 7/10 | تحسن كبير بعد Channel Identity، لكن لا توجد بعد شاشة مراجعة ودمج يدوي وSource Priority. |
| الصحة وFailover | 8/10 | Availability Score وpromotion وheaders المشفرة نقطة قوة؛ يلزم QoE وhysteresis. |
| EPG Operations | 6.5/10 | الأساس قوي، لكن coverage وunmatched per source وعمليات rollback غير مكتملة. |
| تجربة Android TV | 7/10 | توجد وظائف TV وzapping وEPG وMultiview وRTL، لكن compile الفعلي واختبار جهاز TV ما زالا مطلوبين. |
| DVR والتسجيل | 3/10 | غير جاهز للمنافسة المباشرة في هذا المحور، وهو P2 وليس مانعًا لإطلاق Live TV أولي. |
| القياس والدعم | 5.5/10 | توجد مؤشرات تشغيل أساسية، لكن telemetry مجهول وتجميع QoE اليومي غير مكتمل. |

هذه الدرجات هي تقييم هندسي داخلي وليست قياسًا تجريبيًا لأداء المنافسين. الغرض منها ترتيب الاستثمار، لا الادعاء بتفوق مطلق في كل محور.

## 6. الأولويات التالية بعد هذه الجولة

الأولوية الأولى هي بناء **Sync Preview وRollback**: قبل تعطيل القنوات المختفية، يجب عرض الإضافات والتغييرات والحذف، ثم تطبيق المزامنة بعد تأكيد المشرف، مع snapshot قابل للاسترجاع. هذه الميزة تمنع أكبر خطر تشغيلي متبقٍ.

الأولوية الثانية هي **EPG Coverage وUnmatched Console**. يجب عرض نسبة القنوات ذات EPG لكل مصدر، وأسماء القنوات غير المطابقة، وآخر نجاح وسبب الفشل، مع إعادة مطابقة يدوية تحفظ alias آمنًا بدل تغيير tvg-id المصدر.

الأولوية الثالثة هي **QoE Telemetry مجهول**. يجب تسجيل startup p50/p95، إعادة المحاولة، rebuffer، فشل playback، نجاح fallback، وزمن ظهور EPG حسب القناة والمصدر والجهاز دون حفظ IP أو بيانات شخصية غير لازمة.

الأولوية الرابعة هي **صقل Android TV** عبر CI أو Emulator: ترتيب القنوات حسب المفضلة ثم health score داخل المجموعة، Previous Channel، حفظ آخر قناة، focus restoration، ورسائل عربية لحالات offline وdegraded. بعد ذلك فقط يصبح DVR أولوية تجارية منطقية.

## 7. الخلاصة

بعد الجولة الجديدة، أصبح DZ HOOF يملك أساسًا تنافسيًا حقيقيًا في القنوات: القناة المنطقية منفصلة عن المصدر، البديل لا يُختار عشوائيًا، رؤوس المصدر لا تضيع عند promotion، وعمليات الصحة وEPG تظهر في Control Plane واحد. هذه البنية تمنح المشروع ميزة خادمية لا يوفرها مجرد مشغل IPTV.

لكن عبارة «بدون منافسة» لا يمكن إثباتها قبل اختبار ميداني على مصادر قانونية متعددة وأجهزة Android TV فعلية وقياس أزمنة التشغيل والفشل. التوصية المهنية هي عدم التوسع في DVR الآن؛ بل إغلاق Sync Preview/Rollback وEPG Coverage وQoE وTV zapping أولًا، لأنها ستؤثر مباشرة في ثقة المستخدم واستقرار القنوات.

## المراجع

[1]: https://tivimate.com/ "TiviMate — الموقع الرسمي والميزات"

[2]: https://www.sparkleplayer.com/ "Sparkle TV — الموقع الرسمي والميزات ومصادر القوائم"

[3]: https://ottnav.github.io/faq.html "OTT Navigator — FAQ الرسمي وإعداد EPG"

[4]: https://www.iptvsmarters.com/ "IPTV Smarters Pro — الموقع الرسمي"

[5]: https://play.google.com/store/apps/details?id=com.ottplay.ottplay&hl=en_US "Televizo — Google Play"

[6]: https://docs.tvheadend.org/documentation/configuration/electronic-program-guide "Tvheadend — توثيق EPG"

[7]: https://jellyfin.org/docs/general/server/live-tv/setup-guide/ "Jellyfin — Live TV Setup Guide"

[8]: https://github.com/merci1994dz/dzhoot "مستودع DZ HOOF — الكود وخارطة الطريق"
