# جولة الاكتشاف التنافسي — 2026-08-15

## المنهج

تمت مراجعة الصفحات الرسمية أو صفحات المتاجر للمنافسين الذين يركزون على Android TV وLive TV، مع إعطاء الأولوية للميزات التي تؤثر في الاحتفاظ بالمستخدم: EPG، catch-up/timeshift، التسجيل، تعدد القوائم والمصادر، multiview، البحث، التخصيص، واستقرار التشغيل. لا تعني المقارنة اعتماد أي مصدر بث؛ DZ HOOF مخصص للمصادر التي يملك المشغل حق استخدامها فقط.

## النتائج الموثقة

| المنافس | نقاط القوة الظاهرة في المصدر | الدلالة على DZ HOOF |
|---|---|---|
| TiviMate | واجهة كبيرة مخصصة للشاشات، M3U/Xtream/Stalker، EPG، قوائم متعددة، المفضلة، catch-up، التسجيل، البحث، الرقابة الأبوية، وmultiview؛ كما يصرح بأنه مشغل فقط ولا يقدم المحتوى. [[1]](#المراجع) | يجب أن تكون Live TV وEPG والفشل/البديل أسرع وأكثر وضوحًا من مجرد قائمة قنوات. التسجيل ليس أولوية فورية قبل تثبيت QoE وEPG وfailover. |
| Sparkle TV | دعم Android TV وGoogle TV وFire TV، M3U وXtream وXMLTV، DVR/timeshift، صور البرامج في EPG، ترتيب وإخفاء القنوات والفئات، الصوت المتعدد والترجمات، AFR، multiview، VOD، التكامل مع الشاشة الرئيسية، ومصادر متعددة. [[2]](#المراجع) | الأولويات التنافسية هي EPG غني بالصور، جودة التنقل بالريموت، مصدر متعدد وhealth/failover، ثم timeshift وDVR بعد استقرار البنية. |
| OTT Navigator | Live TV وMovies وSeries، صوت وترجمات متعددة، Continue Watching، المفضلة، تصفح الفئات، EPG الآن/التالي، بحث موحد، Media3، HLS/DASH، واشتراط إحضار المستخدم لمصدره. [[3]](#المراجع) | تجربة البحث الموحد وSeriesDetails وQoE التي أضيفت الآن تسد فجوة مهمة؛ الخطوة التالية هي Continue Watching وsubtitle/audio selection والتحقق على TV فعلي. |

## ما تم تنفيذه في DZ HOOF استجابةً للجولة

أصبح لدى المشروع بحث موحد بالقنوات والمحتوى وبرامج EPG، وEPG Coverage مع unmatched console، وهوية قناة متعددة المصادر، health score، failover محمي، Sync Preview/Rollback، وQoE Telemetry مجهولة. في Android أضيف ترتيب القنوات بالمفضلة والصحة، previous channel/focus restoration، وفتح تفاصيل المسلسل ومواسمه مباشرة من نتائج البحث مع Poster.

## الفجوات التنافسية التالية

تظل **اختبارات Android TV/Fire TV الفعلية**، وتشغيل PIN/QR والمشاهدة على Emulator أو جهاز حقيقي، شروطًا عملية قبل إعلان التثبيت النهائي. وبعد تثبيت ذلك، تكون الأولوية الأعلى لـEPG غني بالصور والآن/التالي، Continue Watching، اختيار الصوت والترجمة عند توفرهما، وتحسين إعدادات buffer/codec بناءً على بيانات QoE. يظل DVR/timeshift والتسجيل مرحلة لاحقة حتى لا تُحمّل Live TV بتعقيد قبل استقرار المصدر والقياس.

## المراجع

1. [TiviMate IPTV Player — Google Play](https://play.google.com/store/apps/details?id=ar.tvplayer.tv&hl=en_US)
2. [Sparkle TV — الموقع الرسمي](https://www.sparkleplayer.com/)
3. [OTT Navigator IPTV — Google Play](https://play.google.com/store/apps/details?id=com.ottnavigator.iptvnavigator&hl=en_US)
4. [OTT Navigator FAQ — الموقع الرسمي](https://ottnav.github.io/faq.html)
