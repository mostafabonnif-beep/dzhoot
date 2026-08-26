# توصية دمج مشروع IPTV مفتوح المصدر مع DZ HOOF

**التاريخ:** 2026-08-26  
**المؤلف:** Manus AI

## الخلاصة التنفيذية

بعد فحص مشاريع IPTV مفتوحة المصدر تدعم Android أو Android TV وM3U وXtream وEPG، لا أوصي باستبدال DZ HOOF بالكامل بمشروع خارجي. المشروع الحالي يملك Backend وبيانات المستخدمين واشتراكات Xtream وعمليات الإدارة، بينما المشكلة الأساسية في العميل هي تجربة المشاهدة وواجهة التلفاز ومسار التحديث.

التوصية المهنية هي اعتماد **هندسة هجينة**: الاحتفاظ بـDZ HOOF Backend وAPI وبياناته، وإعادة بناء طبقة العميل تدريجياً فوق Kotlin وJetpack Compose وMedia3 الموجودة، مع الاستفادة من الأفكار القابلة لإعادة التنفيذ من المشاريع المفتوحة. لا ينبغي نسخ كود GPLv3 مباشرة إلى تطبيق خاص، ولا ينبغي نقل المشروع إلى Flutter إلا إذا كان الفريق مستعداً لإعادة كتابة التطبيق وإدارة طبقة جديدة كاملة.

## المقارنة

| المشروع | المنصات | نقاط القوة | الترخيص | ملاءمته لـDZ HOOF |
|---|---|---|---|---|
| **AerioTV** | Android phone/tablet/Google TV | قاعدة Compose واحدة، Xtream وM3U وEPG، Live/VOD/Series، PiP وmultiview، Media3 | GPL-3.0-or-later | قوي تقنياً، لكن نسخ الكود داخل تطبيق خاص يفرض التزامات GPL |
| **OwnTV** | Android TV أساساً | Compose for TV، Xtream وM3U وStalker، EPG وcatch-up، ExoPlayer وmpv، D-pad-first | GPLv3 الحالي | ممتاز للتلفاز، لكنه TV-first وGPL؛ يصلح مرجعاً معمارياً لا مصدراً للنسخ المباشر |
| **IPTVnator** | Electron وPWA وDesktop | M3U/M3U8، Xtream، Stalker، EPG/XMLTV، catch-up، مفضلة | MIT | مناسب للمراجع والتدفق العام، لكنه ليس أساس Android TV أصلياً |
| **Another IPTV Player** | متعدد المنصات، مع Android native في monorepo | Xtream وM3U، Live/VOD/Series، EPG، بحث، مفضلة، resume، downloads، PiP، parental controls | MIT | أفضل مصدر محتمل لاستلهام UX أو مكونات MIT بعد تدقيق ملفات Android فعلياً |
| **clubTivi** | Flutter: Android/Tablet/TV وغيرها | EPG mapping بدرجة ثقة، failover، Smart Channels، D-pad، Xtream وM3U | Apache-2.0 | أفكاره ممتازة وترخيصه مناسب، لكن نقله يعني إعادة كتابة كبيرة من Kotlin إلى Flutter |

## القرار

أوصي باختيار **DZ HOOF Native Client 2.0** بدلاً من دمج مشروع كامل. تكون المرجعيات التصميمية والوظيفية الأساسية هي AerioTV وOwnTV لتجربة Android TV، وAnother IPTV Player وclubTivi لأفكار UX وEPG mapping وfailover، مع إعادة تنفيذ الوظائف داخل كود DZ HOOF الأصلي.

إذا أصررنا على دمج مشروع خارجي فعلياً، فإن **Another IPTV Player** هو المرشح الأول للفحص البرمجي لأنه MIT ويحتوي على ميزات قريبة من المطلوب. أما clubTivi فهو المرشح الثاني للبحث في خوارزميات EPG وfailover، وليس كأساس مباشر بسبب Flutter. لا أوصي بدمج OwnTV أو AerioTV ككود داخل تطبيق خاص بسبب GPLv3 الحالي.

## خطة التطوير المقترحة

### المرحلة الأولى: هوية وتجربة استخدام احترافية

نعيد تصميم Home وLive TV وGuide وVOD وSeries بتصميم موحد داكن، بطاقات واضحة، شريط بحث، مفضلة، Continue Watching، صور logos محسنة، وحالات فارغة وأخطاء مفهومة. على الهاتف يكون التنقل بلمس وإيماءات مناسبة، وعلى التلفاز يكون كل عنصر قابلاً للتركيز مع D-pad وحلقة focus واضحة.

### المرحلة الثانية: مشغل احترافي

يجب تحويل المشغل إلى مركز تجربة موحد يدعم Media3، مع تبديل سريع بين القنوات، إعادة اتصال متدرجة، failover إلى الرابط الاحتياطي، buffer indicator، audio/subtitle tracks، aspect ratio، PiP للهاتف، واستعادة آخر موضع للفيديو. يجب أن يظهر سبب الفشل للمستخدم بدلاً من رسالة عامة.

### المرحلة الثالثة: Guide وEPG

نستخدم مطابقة tvg-id أولاً، ثم aliases وcall-sign بدرجة ثقة، مع عدم قبول fuzzy match منخفض الثقة. نضيف timeline للهاتف وgrid للتلفاز، now/next، catch-up badge، وتحديثاً في الخلفية لا يجمّد الواجهة.

### المرحلة الرابعة: الأداء والاعتمادية

نضيف pagination للقوائم الكبيرة، تحميل الصور التدريجي، caching مضبوطاً، مزامنة في الخلفية، baseline profile، واختبارات على Android phone وGoogle TV وFire TV. لا تُعتبر النسخة جاهزة قبل اختبار ترقية APK فوق نسخة قديمة موقعة بنفس الشهادة.

### المرحلة الخامسة: التوزيع الآمن

يبقى التحديث التلقائي عبر API مع versionCode متزايد وAPK رسمي موقّع وSHA-256 وrollback. خارج Play Store سيظل Play Protect قادراً على عرض تحذير للتطبيق غير المعروف؛ الحل ليس تجاوز الحماية، بل توقيع ثابت، رابط HTTPS، صفحة تحميل موثقة، وشرح واضح للمستخدم.

## المخاطر التي يجب تجنبها

لا يجوز نسخ كود GPLv3 من OwnTV أو AerioTV إلى تطبيق DZ HOOF الخاص دون قبول نشر المصدر وفق GPL. كما لا يجوز نسخ ملفات أو أصول من مشروع MIT أو Apache قبل حفظ إشعار الترخيص ومراجعة التبعيات التابعة له.

لا ينبغي تبديل Backend الحالي بواجهة مشروع خارجي قبل بناء adapter واضح. يجب أن يظل العميل غير قادر على الوصول إلى بيانات الإدارة أو أسرار المزود؛ العميل يحصل فقط على session أو catalog مصرح به عبر API DZ HOOF.

ولا ينبغي إصدار APK باسم أو versionCode قديم. كل إصدار يجب أن يملك versionCode أعلى، وبصمة التوقيع نفسها، وسجل AppVersion، ورابط تنزيل قابل للفحص، وخطة رجوع إلى الإصدار السابق.

## الخلاصة العملية

الطريق الأسرع والأكثر احترافية هو **إعادة تصميم العميل الحالي تدريجياً** بدلاً من استبداله. هذا يحافظ على استثمار DZ HOOF في Backend وقاعدة البيانات ويمنع مخاطر الترخيص والهجرة، وفي الوقت نفسه يسمح ببناء تجربة تضاهي التطبيقات الاحترافية: TV-first على التلفاز، touch-first على الهاتف، EPG سريع، تشغيل ثابت، failover، وبحث ومفضلة حقيقيان.

## المراجع

[1]: https://github.com/jonzey231/AerioTV-Android "AerioTV for Android — repository and README"

[2]: https://github.com/ahXN00/OwnTV "OwnTV — native Android TV IPTV player"

[3]: https://github.com/4gray/iptvnator "IPTVnator — cross-platform IPTV player"

[4]: https://github.com/bsogulcan/another-iptv-player "Another IPTV Player — MIT multi-platform IPTV player"

[5]: https://github.com/clubanderson/clubTivi "clubTivi — Flutter IPTV player with EPG mapping and failover"
