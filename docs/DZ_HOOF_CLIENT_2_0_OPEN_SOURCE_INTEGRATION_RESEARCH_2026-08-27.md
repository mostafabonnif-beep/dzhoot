# بحث مشاريع IPTV مفتوحة المصدر لرفع مستوى DZ HOOF Client 2.0

**المؤلف:** Manus AI  
**التاريخ:** 27 أغسطس 2026  
**النطاق:** Android phone، Android TV، EPG، Live TV، VOD، D-pad، التراخيص، وإمكانية الحفاظ على backend والحسابات الحالية.

## الخلاصة التنفيذية

المشكلة الحالية ليست نقص مكوّن واحد، بل أن تجربة التطبيق ما زالت تحمل أجزاءً من التصميم القديم. لذلك لا أوصي باستبدال DZ HOOF بالكامل بمشروع خارجي؛ هذا سيهدد توافق الحسابات وواجهات Node.js الحالية، ويخلق مخاطر ترحيل قاعدة البيانات والتوقيع والتحديث. المسار الأفضل هو **إعادة بناء واجهة Client 2.0 داخل DZ HOOF مع استعارة أفكار ومكونات محددة من مشاريع permissive-licensed، وإبقاء طبقة الحسابات والـ API وRoom migrations تحت سيطرة المشروع**.

بعد مراجعة المشاريع، فإن **Ultra TV** هو أقرب مرشح تقني لدراسة مكونات Android Native أو إنشاء prototype معزول، لأنه يستخدم Kotlin وJetpack Compose وCompose for TV وMedia3 وRoom وHilt، ويدعم Xtream وM3U وStalker وEPG وVOD وD-pad [1]. ملفه الحالي يعلن ترخيص MIT، مع ضرورة الاحتفاظ بإشعار الترخيص وحقوق النشر [2]. ومع ذلك، لا يجب دمجه مباشرة قبل تدقيق كل ملف وتبعية، لأن MIT للمستودع لا يضمن تلقائياً ترخيص كل أصل أو مكتبة خارجية.

## الترتيب النهائي للمشاريع

| الترتيب | المشروع | التقنية | الهاتف | Android TV | Live/EPG/VOD | الترخيص المراجع | قرار الدمج |
|---:|---|---|---|---|---|---|---|
| 1 | Ultra TV | Kotlin، Compose، Compose-TV، Media3، Room، Hilt | جزئي/مشترك حسب الموديول | قوي | Xtream، M3U، Stalker، EPG، VOD | MIT [2] | أفضل مرجع أو prototype معزول؛ نقل مكونات محددة بعد التدقيق |
| 2 | IPTV Mine Pro | Android، Leanback، M3U | نعم | نعم | Live، Movies، Shows، M3U | MIT [3] | مناسب لأفكار بسيطة وواجهة Leanback؛ محدود مقارنة بـ DZ HOOF |
| 3 | clubTivi | Flutter، Riverpod، GoRouter | نعم | نعم | EPG mapping، failover، Smart Channels | Apache-2.0 [4] | مرجع ممتاز للخوارزميات والسلوك؛ لا يندمج مباشرة مع Kotlin/Compose |
| 4 | AerioTV | Kotlin، Compose، Compose-TV، Media3، Room | نعم | نعم | Live، EPG، VOD، Series، DVR، PiP | GPLv3 [5] | مرجع تصميم ومعمارية فقط؛ ممنوع نسخ الكود في تطبيق مغلق دون معالجة التزامات GPL |
| 5 | OwnTV | Kotlin، Compose-TV، Media3 + libmpv | محدود/لا | قوي جداً | Xtream، M3U، Stalker، EPG، catch-up | GPLv3 [6] | أقوى مرجع D-pad و10-foot؛ لا دمج مباشر في المنتج الخاص |
| 6 | StreamVault | Kotlin، Compose، Room، Hilt، Media3 | غير واضح | TV-first | IPTV وEPG بحسب README | Source-Available Non-Commercial [7] | مرفوض لمنتج تجاري أو خدمة مدفوعة دون إذن كتابي |
| 7 | Open TV | Rust/TypeScript، Tauri/Angular | متعدد المنصات | ريموت TV | M3U، Xtream، قنوات مخصصة | يحتاج تدقيق ملف LICENSE | مرجع product ideas فقط؛ ليس مناسباً لـ Android Native |

## التحليل القانوني

### Ultra TV وIPTV Mine Pro

الترخيص MIT يسمح عادةً بإعادة الاستخدام والتعديل والتوزيع التجاري مع الاحتفاظ بإشعار حقوق النشر والترخيص. لكن يجب التعامل مع كل موديول وملف وتبعية على حدة، وتسجيل المصدر والنسخة والـ hash داخل ملف third-party notices في DZ HOOF. لا ينبغي نسخ شعار أو صور أو نصوص أو مفاتيح API أو خدمات backend من المشروع.

### clubTivi

Apache-2.0 permissive أيضاً، لكنه مكتوب لـ Flutter ويحتوي على تبعيات وخدمات متعددة. يمكن الاستفادة من مفهوم مطابقة EPG ومؤشر صحة المصادر وauto-failover، ثم إعادة التنفيذ في Kotlin بصورة مستقلة. إذا نُقل كود فعلي، يجب الاحتفاظ بإشعار Apache وملف NOTICE عند الحاجة وفحص تراخيص التبعيات.

### AerioTV وOwnTV

ملفات LICENSE الحالية في المشروعين هي GPLv3. نسخ كود Android أو دمجه في تطبيق DZ HOOF مغلق المصدر قد يفرض إتاحة المصدر والعمل المشتق تحت GPL. لذلك قرارنا الآمن هو استخدامهما كـ **مراجع سلوكية وتصميمية** فقط: ندرس مسارات D-pad، شكل Guide، player overlay، focus ring، وإدارة الحالة، ثم نكتب تنفيذ DZ HOOF مستقلاً.

### StreamVault

ترخيص StreamVault الحالي غير تجاري، ويفرض attribution وروابط المشروع وذكر أن النسخة مشتقة منه، ويمنع الاستخدام التجاري دون موافقة كتابية. لهذا لا يصلح قاعدة لتطبيق DZ HOOF الموزع للزبائن.

## ما الذي يجب أن نأخذه إلى DZ HOOF؟

| المجال | التنفيذ المقترح في DZ HOOF | مصدر الفكرة |
|---|---|---|
| Home | Hero واضح، Now Playing، Continue Watching، rails حسب النوع، ومركز إجراءات واحد | Ultra TV وAerioTV كمرجع بصري |
| Live TV | تخطيط TV بثلاث مناطق: مجموعات، قنوات، معاينة؛ والهاتف يتحول إلى tabs/sections | Ultra TV |
| Guide | شبكة زمنية أفقية، رأس قناة ثابت، مؤشر NOW، now/next، وdrawer للمجموعات | Ultra TV وOwnTV |
| D-pad | focus ring ظاهر، autofocus محسوب، Left/Right يفتحان المجموعة أو overlay، وBack يغلق الطبقة قبل الخروج | OwnTV وclubTivi |
| EPG | parsing خارج Main thread، cache لا يُستبدل إلا بعد اكتمال parse، hydration قابل للإلغاء، ومطابقة tvgId/call-sign/name | clubTivi وميزات DZ HOOF الحالية |
| Failover | health score للمصادر، بديل دافئ، وحد زمني واضح قبل الانتقال، مع شارة fallback | clubTivi وطبقة المشغل الحالية |
| VOD | hero details، continue watching، progress، seasons/episodes، وposter rails responsive | Ultra TV/AerioTV كمرجع |
| Player | overlay موحد، EPG drawer، stats، sleep timer، audio/subtitle، ورسائل network/server/source مفصلة | Ultra TV وOwnTV |
| Data safety | عدم تغيير auth أو مصدر الحسابات؛ migrations additive؛ backup قبل أي schema change | قرار معماري خاص بـ DZ HOOF |

## خطة الدمج الموصى بها

### المرحلة الأولى: إعادة تصميم مستقلة داخل DZ HOOF

ننشئ طبقة تصميم جديدة باسم `client2` أو `designsystem/v2` تحتوي على tokens، ألوان، typography، focus states، TV-safe margins، cards، rails، hero، drawer، وplayer chrome. لا ننسخ شاشات مشروع خارجي. نعيد استخدام نماذج DZ HOOF الحالية وcallbacks نفسها، حتى تبقى الحسابات والمفضلة وسجل المشاهدة متوافقة.

### المرحلة الثانية: تثبيت بنية التنقل

نحوّل Home وLive وGuide وCatalog إلى shell موحد. على الهاتف يكون التنقل touch-first مع bottom navigation/sections، وعلى التلفاز يكون D-pad-first مع rail/sidebar وfocus traversal. يجب أن يكون كل عنصر تفاعلي قابلاً للوصول بالـ D-pad، وأن يغلق Back الطبقة الحالية قبل الخروج من الشاشة.

### المرحلة الثالثة: EPG وfailover

نستفيد من أفكار clubTivi وOwnTV دون نسخ كود GPL: مطابقة EPG بعدة درجات ثقة، preloading قابل للإلغاء، cache ذري بعد parse مكتمل، وhealth tracker للمصادر. هذه المرحلة ترفع جودة المشاهدة أكثر من تغيير الألوان وحده.

### المرحلة الرابعة: نقل مكونات MIT بشكل انتقائي

إذا أثبت prototype أن Ultra TV يحتوي مكوناً يوفر وقتاً حقيقياً، نراجع commit المحدد، ملف LICENSE، copyright headers، التبعيات، والاختبارات. بعدها ننقل المكون أو نعيد كتابته، ونضيف إشعار MIT داخل `THIRD_PARTY_NOTICES.md` وشاشة About. لا ننقل قاعدة البيانات أو auth أو updater أو signing logic من مشروع خارجي.

### المرحلة الخامسة: التحقق

يجب تشغيل اختبارات Kotlin وRoom migrations وLint، ثم اختبار هاتف فعلي وAndroid TV فعلي أو AVD. مع كل تغيير UI نتحقق من مسارات D-pad، Back، focus restoration، RTL العربية، HLS، EPG empty/error states، والمفضلة. لا يُرفع أي إصدار للزبائن قبل تحقق التوقيع والـ SHA-256 ومسار التحديث.

## القرار النهائي

**لا ندمج مشروعاً كاملاً فوق DZ HOOF.** نستخدم Ultra TV كأفضل مرجع Native/Compose ومرشح prototype MIT محدود، ونستخدم OwnTV/AerioTV كمرجع تجربة TV فقط، وclubTivi كمرجع خوارزميات EPG وfailover، وIPTV Mine Pro كمرجع Leanback بسيط. بهذه الطريقة نحصل على تطبيق مختلف جذرياً عن التصميم القديم مع الحفاظ على backend Node.js، الحسابات، Room data، والمشغل الحالي.

الخطوة العملية التالية هي إنشاء فرع تجريبي معزول باسم `client-2.0/ultra-inspired-shell`، وبناء شاشة Home/Live/Guide جديدة وفق هذه الخطة، من دون إدخال أي كود GPL أو تغيير schema أو auth. بعد الموافقة البصرية والوظيفية، ننقل التحسينات إلى الفرع الرئيسي للتطوير.

## المراجع

[1]: https://github.com/khalilbenaz/ultra-tv "Ultra TV — Android Native IPTV player"
[2]: https://raw.githubusercontent.com/khalilbenaz/ultra-tv/main/LICENSE "Ultra TV — MIT License"
[3]: https://f-droid.org/en/packages/com.samyak.iptvminepro/ "IPTV Mine Pro — F-Droid listing and MIT License"
[4]: https://raw.githubusercontent.com/clubanderson/clubTivi/main/LICENSE "clubTivi — Apache License 2.0"
[5]: https://raw.githubusercontent.com/jonzey231/AerioTV-Android/main/LICENSE "AerioTV — GPLv3 License"
[6]: https://raw.githubusercontent.com/ahXN00/OwnTV/main/LICENSE "OwnTV — GPLv3 License"
[7]: https://raw.githubusercontent.com/Davidona/StreamVault-IPTV/master/LICENSE "StreamVault — Source-Available Non-Commercial License"
[8]: https://github.com/clubanderson/clubTivi "clubTivi — EPG mapping, failover and Android TV focus reference"
[9]: https://github.com/fredolx/open-tv "Open TV — cross-platform IPTV reference"
