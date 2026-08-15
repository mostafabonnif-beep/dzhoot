# تقرير الفحص التقني لمشروع DZ HOOF

**المستودع:** [`merci1994dz/dzhoot`](https://github.com/merci1994dz/dzhoot)  
**الفرع المفحوص:** `main`  
**آخر التزام مفحوص:** `d07bbcc`  
**تاريخ الفحص:** 15 أغسطس 2026  
**إعداد:** Manus AI

## 1. الخلاصة التنفيذية

المشروع يمتلك أساسًا تقنيًا جيدًا وقابلًا للتوسع: مستودع واحد يضم Backend بـ Express/MongoDB/Redis، لوحة إدارة Next.js، وتطبيق Android/Android TV يعتمد Media3، مع وجود حماية Helmet وCORS وCSRF وRate Limiting وحماية SSRF وتوكنات تشغيل مشفّرة وسجل تدقيق ومصادقة ثنائية للمشرف. كما أن بناء TypeScript وبناء الواجهة الأمامية ينجحان، ونجح 16 من أصل 17 مجموعة اختبار Backend في الفحص المحلي بعد بناء الحزمة المشتركة. هذه نقاط قوية وليست مشروعًا يبدأ من الصفر.[1] [2]

مع ذلك، **لا أوصي بإطلاقه للعامة أو بيعه في وضعه الحالي** قبل معالجة مجموعة من النقاط الأمنية والتشغيلية. أخطر مشكلة وجدتها هي أن بوابة الاشتراك مطبّقة على مساري `POST /tv/playback-token` و`POST /streams/authorize` فقط، بينما يمكن لمسارات قوائم التشغيل العامة توليد توكنات تشغيل جديدة دون فحص الاشتراك، كما أن نقطة `GET /tv/playback/:token` تتحقق من صلاحية المستخدم والكود فقط ولا تعيد التحقق من الاشتراك النشط. هذا يجعل انتهاء الاشتراك غير كافٍ لمنع الوصول إلى البث.[3] [4] [5] [6]

المشكلة الثانية هي أن `channelListCode` يعمل عمليًا ككلمة مرور Bearer من ستة أحرف، ويُستخدم في روابط عامة مثل `/playlist/:code` و`/epg/:code` و`/verify/:code`. بعض هذه المسارات لا يمر عبر محدد معدل مناسب، وتقوم نقطة التحقق العامة بإرجاع اسم المستخدم ودوره وعدد القنوات. يجب استبدال هذا النموذج برمز جهاز أو جلسة قابلة للإلغاء والتدوير، أو على الأقل تشديد المعدلات وإيقاف كشف المعلومات.

| المجال | التقييم | القرار المقترح |
|---|---:|---|
| أساس Backend والميزات الأساسية | جيد | الاستمرار مع إصلاحات مركزة |
| أمان البث والاشتراكات | يحتاج إصلاحًا عاجلًا | **P0 قبل أي نشر عام** |
| جودة الاختبارات | Backend جيد جزئيًا، Frontend ضعيف، Android غير مثبت محليًا | رفع التغطية وإنشاء E2E حقيقية |
| Android/Android TV | غير جاهز للإصدار المثبت | بناء APK واختبار جهاز/محاكي TV |
| التعريب وإعادة التسمية | جزئيان وغير متسقين | توحيد i18n وإزالة بقايا FireVision |
| الإنتاج والنشر | بنية موجودة لكن غير مقفلة | حماية GitHub، نسخ احتياطية، staging، release |

## 2. أهم النقائص حسب الأولوية

### P0 — يجب إصلاحها قبل الإطلاق

#### 2.1 تجاوز بوابة الاشتراك عبر قوائم التشغيل والتوكنات

في `tv.js` تقوم مسارات `/playlist/:code` و`/playlist/:code/json` بإرجاع أو توليد روابط تشغيل، ومولّد القائمة في `User.ts` ينشئ `playback token` لكل قناة. لكن هذه المسارات لا تستدعي `isSubscriptionRequired()` أو `getActiveSubscription()`. كذلك، مسار `/playback/:token` يفك التوكن ويتحقق من وجود المستخدم ونشاطه والكود، لكنه لا يتحقق من أن الاشتراك ما زال فعالًا.[3] [4] [5]

النتيجة العملية هي أن تفعيل `SUBSCRIPTION_REQUIRED=true` لا يحمي كامل دورة البث. المستخدم المنتهي اشتراكه يستطيع، بحسب المسار المستخدم، الحصول على قائمة أو توكنات جديدة، كما أن توكنًا صادرًا من القائمة لا يُرفض تلقائيًا عند نقطة البروكسي بعد انتهاء الاشتراك. هذا يتعارض مباشرةً مع هدف خارطة الطريق الذي ينص على منع الوصول بعد انتهاء الاشتراك.[2]

**الإجراء المطلوب:** إنشاء خدمة موحدة مثل `authorizePlaybackAccess(userId, contentId, tokenContext)` واستدعاؤها في ثلاث نقاط: عند إصدار أي توكن، عند استهلاك التوكن في `/playback/:token`، وعند توليد أي Playlist. يجب إضافة اختبارات API صريحة للحالات التالية: اشتراك فعال، اشتراك منتهٍ، مستخدم إداري، علم الاشتراك معطل، توكن قديم، وإلغاء حساب المستخدم. وإذا كان السماح بالقائمة لأغراض المزامنة مطلوبًا، فيجب فصل `catalog sync token` عن `playback token` حتى لا تمنح مزامنة القائمة صلاحية مشاهدة.

#### 2.2 `channelListCode` سر وصول مكشوف وقابل للتخمين نسبيًا

الكود مولّد من ستة رموز من مجموعة أحرف وأرقام، ويُستخدم مباشرةً في مسارات عامة مثل `/playlist/:code` و`/playlist/:code/json` و`/epg/:code` و`/verify/:code`. المسارات العامة تبحث عن المستخدم بهذا الكود، وتستطيع إرجاع قائمة المستخدم أو معلومات عنه. كما أن `/verify/:code` يعيد اسم المستخدم والدور وعدد القنوات، وهو تسريب معلومات غير ضروري.[4] [7]

حتى لو كان فضاء الاحتمالات كبيرًا نسبيًا، فإن هذا الكود ليس معرفًا عاديًا؛ إنه **credential**. وجوده في URL يجعله معرضًا لسجلات الخادم، سجل المتصفح، أدوات التحليل، لقطات الشاشة، والمشاركة غير المقصودة. كما أن محدد المعدل المخصص للتزاوج لا يغطي بنفس الوضوح كل مسارات القوائم وEPG، بينما حماية هذا السر يجب أن تكون موحدة.[3]

**الإجراء المطلوب:** نقل التطبيق إلى `Device Access Token` عشوائي طويل، مخزن على الخادم بصيغة hash، مع تاريخ انتهاء وتدوير وإلغاء لكل جهاز. لا ترسل الكود السري في URL بعد ذلك؛ استخدم `Authorization: Bearer` أو جلسة جهاز. وإذا تعذر التغيير الآن، فاجعل الكود لا يقل عن 32 بايتًا عشوائيًا، طبّق Rate Limiting على جميع مسارات `playlist`, `epg`, `verify`, و`pair`, أوقف endpoint التحقق العام أو اجعله يعيد نتيجة عامة بلا اسم/دور، وأضف تسجيلًا مدققًا لمحاولات الفشل.

#### 2.3 تهيئة المشرف الإنتاجي لا ترفض كل القيم الافتراضية

التحقق في `server.js` يرفض بعض أسرار JWT الضعيفة، لكنه يرفض لكلمة مرور المشرف القيمة `admin123` فقط. أما `initSuperAdmin.ts` فيصدر تحذيرًا عند القيمة المعروفة بدل إيقاف التشغيل، ويستخدم قيمة تطويرية افتراضية خارج الإنتاج. كما أن ملف القالب الإنتاجي يحتوي على placeholders يجب ألا تمر إلى تشغيل فعلي.[8] [9]

**الإجراء المطلوب:** في `NODE_ENV=production` يجب إيقاف التشغيل إذا كانت كلمة مرور المشرف أقل من حد قوي أو تساوي أي placeholder مثل `CHANGE-ME`, `ChangeMeNow123!`, `your-...`, أو قيمة موجودة في ملفات الأمثلة. يجب عدم تحديث كلمة المرور تلقائيًا عند كل إقلاع إلا عبر عملية إدارية صريحة، ويجب حذف طباعة بيانات الاعتماد أو `channelListCode` من سجلات الإقلاع. بعد أول تهيئة، اجعل إنشاء المشرف Migration/Bootstrap منفصلًا عن تشغيل التطبيق.

#### 2.4 معالجة ثغرات الاعتماديات قبل الإصدار

نتيجة `npm audit --omit=dev` في الفحص المحلي كانت **32 ثغرة: 2 منخفضة، 17 متوسطة، 12 عالية، و1 حرجة**. الثغرة الحرجة ظهرت في `handlebars`، كما ظهرت ثغرات عالية مرتبطة بـ `form-data` و`path-to-regexp` و`picomatch`، إضافة إلى مشكلات في `postcss` و`nodemailer` وغيرها.[10]

لا أنصح بتشغيل `npm audit fix --force` عشوائيًا لأنه قد يفرض ترقيات كبرى. المطلوب هو إنشاء جدول Dependency Risk، معرفة أي حزمة تصل إلى runtime فعليًا، ترقية `handlebars` أولًا، ثم اختبار كل ترقية على حدة، وإضافة فحص SCA إلى CI مع فشل البناء عند وجود ثغرة حرجة أو عالية قابلة للاستغلال في runtime.

### P1 — يجب إنجازها قبل Pilot عام

#### 2.5 الاختبارات الحالية لا تغطي رحلة المستخدم الحقيقية

اختبارات Backend قوية نسبيًا من حيث العدد، لكن الفحص المحلي أظهر 147 اختبارًا ناجحًا من 152، مع فشل مجموعة `stream-session-service.test.ts` بسبب مهلة تهيئة MongoDB المشتركة. السبب البنيوي أن `jest.config.js` يفرض `src/test/setup.ts` على كل الاختبارات، وهذا الملف يبدأ MongoMemoryServer حتى في اختبارات وحدات لا تحتاج قاعدة بيانات.[11] [12]

اختبارات الواجهة الأمامية محصورة في ملفين فقط، ونجحت في الفحص بنتيجة 5 اختبارات. أما اختبار Playwright الوحيد فيتحقق من تحميل الصفحة وتسجيل الدخول وعرض مسارات الإدارة، لكنه لا ينفذ رحلة استيراد M3U، الاقتران، تشغيل قناة، انتهاء الاشتراك، انقطاع Redis، أو أخطاء مصدر البث.[13] [14]

**الإجراء المطلوب:** فصل إعدادات `unit`, `integration`, و`e2e`. اختبارات الوحدات لا يجب أن تشغّل MongoDB. استخدم MongoDB وRedis في خدمة CI مخصصة لاختبارات التكامل، وأضف E2E واحدة كاملة على الأقل: تسجيل الدخول، إنشاء/استيراد مصدر مصرح، مزامنة قناة، اقتران جهاز، إصدار توكن، تشغيل Manifest تجريبي، ثم رفض التشغيل بعد انتهاء الاشتراك. يجب كذلك إضافة اختبارات من خارج الصلاحية: مستخدم يحاول قناة غير معينة، مستخدم منتهٍ، وكود جهاز ملغى.

#### 2.6 Android غير مثبت البناء خارج CI

محاولة `./gradlew test --no-daemon` محليًا فشلت لأن `ANDROID_HOME` و`ANDROID_SDK_ROOT` غير معرفين و`local.properties` غير موجود، لا بسبب خطأ Kotlin مثبت. في المقابل، CI يثبت Java وAndroid SDK ويشغل `testDebugUnitTest` و`assembleDebug`.[15] [16]

هذا يعني أن المشروع لا يزال يفتقد دليلًا عمليًا لبناء APK من جهاز مطور أو بيئة نشر قابلة لإعادة الإنتاج. كما أن إعداد عنوان API يستخدم `https://example.invalid/` كقيمة افتراضية؛ وهذا أفضل من عنوان حقيقي ثابت، لكنه يسمح ببناء APK غير صالح إذا لم يمرر المطور قيمة حقيقية.[15]

**الإجراء المطلوب:** إضافة `local.properties.example`، توثيق إصدارات SDK وBuild Tools، جعل `assembleDebug` يفشل برسالة واضحة إذا بقي العنوان `example.invalid`، وإضافة Artifact metadata يحتوي على version وcommit وAPI environment. قبل أي Release يجب اختبار Android TV وFire TV بجهاز فعلي أو محاكي TV، وليس هاتفًا فقط.

#### 2.7 التعريب موجود لكنه غير قابل للتوسع بالكامل

يوجد `LocaleProvider` يدعم العربية والإنجليزية والفرنسية، وهذه نقطة جيدة، لكن القاموس مسطح وموجود داخل ملف TypeScript واحد، ولا يحتوي على interpolation أو pluralization أو namespaces أو تنسيق موحد للتواريخ والأرقام. في الوقت نفسه، ما زالت مكونات كبيرة مثل `channels-page-shell.tsx` تضع نصوصًا عربية وإنجليزية مباشرة داخل JSX، وتستخدم `confirm()` الأصلي للحذف.[17] [18]

في Android الوضع أوضح: `AddSourceScreen.kt` يحتوي على نصوص إنجليزية صلبة، ورابطًا إلى دليل FireVision القديم، ومنطق انتقال يعتمد على مقارنة النص `Playlist loaded` بدل حالة typed أو enum. هذا يجعل تغيير اللغة أو تعديل رسالة الخادم قادرًا على كسر انتقال الشاشة إلى الصفحة الرئيسية.[19]

**الإجراء المطلوب:** نقل كل النصوص إلى `strings.xml` و`values-ar/strings.xml`، استخدام حالات typed مثل `PlaylistLoadState.Success` بدل مقارنة النصوص، وتوفير اختبارات Compose وD-pad لمسارات التركيز والتنقل. يجب كذلك تنفيذ إعادة تسمية تدريجية للأصناف والـpackages والتعليقات والروابط القديمة، مع إبقاء aliases فقط إذا كانت هناك بيانات أو deep links تحتاج توافقًا خلفيًا.

#### 2.8 بقايا هوية FireVision وخلط أسماء الحزم

ما زالت أسماء مثل `@firevision/backend` و`@firevision/frontend` و`firevision-iptv` موجودة في ملفات الحزم، وتظهر بقايا FireVision في README وMakefile وAndroid README وملفات التغيير وبعض أسماء الأصناف. هذا لا يوقف التشغيل، لكنه يخلق التباسًا في الدعم، ويجعل المستخدم يصل إلى روابط upstream أو يرى اسم منتج مختلف.[1] [20] [21]

**الإجراء المطلوب:** اعتماد قاموس رسمي للأسماء، ثم تنفيذ rename على مراحل: أسماء الحزم الداخلية، عنوان التطبيق، روابط GitHub، Sentry project، Makefile، changelog، Android navigation، ثم الوثائق. يجب عدم تغيير package ID أو مسارات البيانات بلا خطة migration، لأن ذلك قد يكسر التحديثات أو التخزين المحلي.

#### 2.9 نشر GitHub غير مقفل ولا توجد إصدارات منشورة

المستودع عام، والفرع `main` غير محمي بحسب حالة GitHub التي فُحصت، ولا توجد Releases منشورة. توجد workflow تبني APK Debug وترفع artifact، لكن لا توجد عملية إصدار كاملة تنتج GitHub Release موثقًا مع checksum وAPK Release موقّع.[16] [22]

**الإجراء المطلوب:** تفعيل حماية `main` واشتراط Pull Request وCI ناجح ومراجعة واحدة على الأقل، حذف الفروع المندمجة، إضافة Dependabot أو Renovate، ثم إنشاء workflow للإصدار يدويًا عند tag موقّع. يجب نشر APK Release وملف SHA-256 وnotes ونسخة API المتوافقة، وعدم رفع keystore أو `google-services.json` الحقيقي إلى المستودع.

#### 2.10 الجاهزية التشغيلية والنسخ الاحتياطية غير مكتملة

يوجد Docker Compose إنتاجي وhealthchecks ومسار liveness/readiness، وهذه بنية جيدة، لكن تشغيل scheduler يعتمد على `sleep 300`، ويستخدم الشبكة الخارجية، ولا يظهر في الفحص مسار كامل ومختبر لاستعادة MongoDB وRedis أو staging مستقل قبل production.[23]

**الإجراء المطلوب:** استبدال التأخير الثابت بانتظار readiness حقيقي، إضافة backup دوري لـMongoDB مع retention واختبار restore شهري، عدم اعتبار Redis مصدرًا وحيدًا لقيود الأمان، إضافة مراقبة latency/error rate ومعدل فشل المصادر، وتوثيق Runbook للحوادث والتراجع.

### P2 — تحسينات مهمة بعد تثبيت الأساس

| الأولوية | النقص | التطوير المقترح |
|---|---|---|
| P2 | مكونات Frontend ضخمة | تقسيم `channels-page-shell.tsx` و`import-page-shell.tsx` إلى hooks، data services، dialogs، tables، وforms مستقلة |
| P2 | غياب نظام تصميم موحد كامل | توحيد Dialog، Toast، Button، Empty state، Loading state، وFocus state بدل مزج مكونات أصلية مع مكونات خاصة |
| P2 | تكرار الوصول للبيانات | اعتماد React Query/SWR أو طبقة cache موحدة مع invalidation واضح بعد CRUD والاستيراد |
| P2 | قابلية المراقبة | إضافة metrics لـp95 latency، أخطاء proxy، liveness لكل مصدر، عدد التوكنات، ورفض الاشتراك |
| P2 | إدارة المصادر | إضافة preview قبل استيراد M3U، dry-run، rollback، وتقرير للقنوات المكررة أو غير الصالحة |
| P2 | Android UX | اختبار اتجاه RTL، أحجام النص، focus ring، remote back، حالات الشبكة، واستئناف التشغيل على Android TV فعلي |
| P2 | المنتج | تأجيل VOD وSeries إلى ما بعد إغلاق security gate وMVP playback؛ لا تضف ميزات تجارية قبل تثبيت حدود الأجهزة والتوكنات |

## 3. نتائج التحقق التي نفذتها

| الفحص | النتيجة | الملاحظة |
|---|---|---|
| `npm ci --ignore-scripts` | نجح | 1493 حزمة، مع تحذيرات deprecated |
| `npm run typecheck` | نجح | بعد بناء `@firevision/shared` |
| `npm run lint` | نجح مع 237 تحذيرًا | لا توجد أخطاء، لكن كثرة `no-explicit-any` تستحق خطة تنظيف |
| `npm run build` | نجح | Backend وFrontend؛ ظهرت تحذيرات Sentry و`<img>` و`punycode` |
| Backend tests | 147/152 ناجحة | مجموعة stream-session فشلت بسبب setup/Mongo timeout |
| Frontend tests | 5/5 ناجحة | مجموعتا اختبار فقط |
| Android `./gradlew test` | لم يبدأ الاختبارات | SDK location غير موجود؛ JDK موجود |
| `npm audit --omit=dev` | 32 ثغرة | 2 منخفضة، 17 متوسطة، 12 عالية، 1 حرجة |
| GitHub CI | آخر تشغيلات مفحوصة ناجحة | لا يوجد Release منشور، و`main` غير محمي بحسب الفحص |

تحذيرات lint ليست فشلًا حاليًا، لكنها تعني أن قواعد الجودة متساهلة: 237 تحذيرًا، معظمها `any`. أقترح تقسيمها إلى milestones بدل تفعيل `--max-warnings=0` دفعة واحدة، ثم منع `any` في الوحدات الأمنية ومسارات API أولًا.

## 4. خطة تنفيذ عملية مقترحة

### الأسبوع الأول: إغلاق الأمن الوظيفي

ابدأ بتوحيد دالة تفويض البث وإضافة فحص الاشتراك عند إصدار التوكن وعند استهلاكه. بعد ذلك أضف اختبارات regression تثبت أن Playlist وJSON وEPG لا تعيد صلاحية مشاهدة لمستخدم منتهٍ، وأن إلغاء الحساب أو تدوير رمز الجهاز يلغي كل التوكنات السابقة. في نفس الأسبوع، أوقف كشف معلومات `verify/:code` وطبّق rate limiting موحدًا على كل مسارات الأكواد.

### الأسبوع الثاني: أسرار الإنتاج والاعتماديات

اجعل startup يفشل عند كل placeholder إنتاجي، ولّد secrets مستقلة، حدّث Handlebars أولًا، ثم أصلح بقية ثغرات runtime مع تشغيل الاختبارات بعد كل ترقية. أضف فحصًا في CI يمنع merge عند ثغرة حرجة، ويصدر تقريرًا واضحًا بدل إخراج عام من `npm audit`.

### الأسبوع الثالث: الاختبار والإصدار

افصل unit/integration setup، وأضف MongoDB وRedis إلى CI كخدمات اختبار عند الحاجة فقط. نفّذ رحلة E2E كاملة من login إلى playback وإلى رفض expired subscription. جهز Android SDK موثقًا، ثم أخرج APK Debug قابلًا للتثبيت على Android TV. بعد نجاح ذلك، أضف Release workflow موقّعًا مع checksum وnotes.

### الأسبوع الرابع: الهوية وتجربة المستخدم

طبّق i18n على namespaces حسب المجال، انقل Android strings إلى الموارد، قسم المكونات الكبيرة، وأزل بقايا FireVision من الواجهة والوثائق والروابط. بعدها نفّذ اختبار قبول يدوي على شاشات TV وواجهة الإدارة بالعربية والإنجليزية.

## 5. ما لا أنصح بإضافته الآن

لا أنصح بإضافة الدفع الإلكتروني أو DRM أو CDN متعدد المناطق أو VOD/Series قبل إغلاق التفويض والاشتراكات والنسخ الاحتياطية وبناء Android. إضافة ميزات جديدة فوق مسار بث غير محكوم ستضاعف سطح الهجوم والديون التقنية، ولن تقرب المشروع من إصدار قابل للاستخدام بقدر إصلاح النقاط السابقة.

## 6. الخلاصة النهائية

**المشروع جيد كأساس MVP متقدم، لكنه ليس Release-ready بعد.** الأولوية ليست إعادة كتابة النظام، بل إغلاق فجوات محددة: فرض الاشتراك على كامل سلسلة البث، استبدال `channelListCode` ببيانات اعتماد جهاز آمنة، رفض placeholders الإنتاجية، معالجة ثغرات الاعتماديات، فصل إعدادات الاختبار، تثبيت Android، ثم توحيد التعريب وإعادة التسمية.

إذا نُفذت بنود P0 أولًا، فسيكون المشروع أقرب بكثير إلى Pilot محدود. أما قبل ذلك، فإن إطلاقه للعامة قد يسمح باستمرار مشاهدة المستخدم بعد انتهاء الاشتراك أو تسريب قوائم القنوات عبر credential موجود في URL، وهو خطر تجاري وأمني مباشر.

## المراجع

[1]: https://github.com/merci1994dz/dzhoot/blob/main/README.md "README المشروع"
[2]: https://github.com/merci1994dz/dzhoot/blob/main/PROJECT_ROADMAP.md "خارطة طريق المشروع"
[3]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/routes/tv.js "مسارات TV والبث والقوائم"
[4]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/models/User.ts "نموذج المستخدم ومولّد Playlist"
[5]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/routes/streams.js "مسار تفويض البث"
[6]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/services/subscription-service.ts "خدمة الاشتراكات"
[7]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/middleware/requireTvOrSessionAuth.ts "مصادقة TV والجلسة"
[8]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/server.js "تهيئة الخادم والحماية"
[9]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/utils/initSuperAdmin.ts "تهيئة المشرف الأول"
[10]: https://github.com/merci1994dz/dzhoot/blob/main/server/package-lock.json "قفل اعتماديات Node.js"
[11]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/jest.config.js "إعداد Jest"
[12]: https://github.com/merci1994dz/dzhoot/blob/main/server/backend/src/test/setup.ts "تهيئة اختبارات Backend"
[13]: https://github.com/merci1994dz/dzhoot/tree/main/server/frontend/src/__tests__ "اختبارات Frontend"
[14]: https://github.com/merci1994dz/dzhoot/blob/main/server/e2e/smoke.spec.ts "اختبار Playwright smoke"
[15]: https://github.com/merci1994dz/dzhoot/blob/main/android/app/build.gradle.kts "إعداد بناء Android"
[16]: https://github.com/merci1994dz/dzhoot/blob/main/.github/workflows/ci.yml "Workflow التكامل المستمر"
[17]: https://github.com/merci1994dz/dzhoot/blob/main/server/frontend/src/components/locale-provider.tsx "مزود الترجمة"
[18]: https://github.com/merci1994dz/dzhoot/blob/main/server/frontend/src/components/channels-page-shell.tsx "مكوّن إدارة القنوات"
[19]: https://github.com/merci1994dz/dzhoot/blob/main/android/app/src/main/java/com/dzhoof/iptv/presentation/ui/screens/AddSourceScreen.kt "شاشة إضافة المصدر في Android"
[20]: https://github.com/merci1994dz/dzhoot/blob/main/android/README.md "وثائق Android"
[21]: https://github.com/merci1994dz/dzhoot/blob/main/server/package.json "حزمة monorepo"
[22]: https://github.com/merci1994dz/dzhoot/releases "إصدارات GitHub للمشروع"
[23]: https://github.com/merci1994dz/dzhoot/blob/main/server/docker-compose.production.yml "تكوين Docker الإنتاجي"

