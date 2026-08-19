# مشاريع مقترحة لإكمال Dzhoof

تاريخ البحث: 2026-08-10

## النتيجة

لا أنصح بدمج مشروع كامل جديد داخل Dzhoof الآن. الأفضل إبقاء `FireVisionIPTVServer` كأساس للخادم والإدارة، ثم أخذ أفكار أو وحدات صغيرة من المشاريع المرخّصة بوضوح.

## الأولوية

1. **clubTivi** — https://github.com/clubanderson/clubTivi
   - Apache-2.0.
   - مفيد لـ: دمج عدة مصادر، مطابقة EPG، Smart Channels، التحويل التلقائي عند توقف مصدر، البحث والمفضلة، ودعم الريموت.
   - مناسب للدراسة أو نقل خوارزميات مستقلة إلى عميل Dzhoof بعد مراجعة الكود والرخصة.

2. **AerioTV-Android** — https://github.com/jonzey231/AerioTV-Android
   - MIT.
   - مفيد لـ: تطبيق Android TV حديث بـ Kotlin وCompose، Xtream وM3U، EPG، VOD، الاستمرار من مكان التوقف، وتحسين تجربة التلفاز.
   - أفضل مرشح لأخذ أفكار واجهة وتجربة المستخدم، وليس لاستبدال تطبيق Dzhoof مباشرة.

3. **Ultra TV** — https://github.com/khalilbenaz/ultra-tv
   - MIT.
   - مفيد لـ: Stalker/Ministra، Xtream، M3U، الأفلام والمسلسلات، الحلقات، EPG، البحث، الترجمة والمسارات الصوتية.
   - مفيد إذا كان Stalker أو VOD/series ناقصاً في Dzhoof.

4. **M3UAndroid** — https://github.com/oxyroid/M3UAndroid
   - GPL-3.0.
   - قوي ومحدث ويدعم Android TV وEPG وXtream وVOD/series.
   - لا ندمج كوده داخل مشروع تجاري مغلق دون مراجعة التزامات GPL؛ نستخدمه كمرجع أو نلتزم بـ GPL بالكامل.

5. **XtreamPulsar** — https://github.com/dearbulut/xtreampulsar
   - الرخصة ليست MIT/Apache؛ صفحة المشروع تذكر Business Source License 1.1.
   - مفيد كمرجع لتصميم الباقات، الاشتراكات، المستخدمين، الأجهزة، Xtream API، VOD والمسلسلات.
   - لا ننسخ كوده قبل مراجعة الرخصة وشروط الاستخدام التجاري.

## ما ينقص Dzhoof فعلياً

- ربط الخادم بعنوان حقيقي بدلاً من `https://dzhoof.example/`.
- إضافة مصادر IPTV قانونية يملك المستخدم حق تشغيلها.
- اختبار كامل لتسجيل الدخول، الاقتران، القنوات، EPG، الأجهزة وتحديث APK.
- وظائف VOD والأفلام والمسلسلات والحلقات إن كانت مطلوبة في النسخة الأولى.
- الاشتراكات والباقات والدفع إن كان المشروع خدمة مدفوعة.
- تحسين البحث والمفضلة وتجربة الريموت والـ EPG.
- إعداد Android SDK وFirebase وملف توقيع Release لإخراج APK قابل للتوزيع.
- إعداد MongoDB وRedis وHTTPS ونسخ احتياطي ومراقبة قبل النشر العام.

## القرار المقترح

المرحلة التالية: نضيف إلى Dzhoof أولاً **VOD/series + EPG محسّن + بحث ومفضلة + واجهة TV**، ونستفيد من أفكار `AerioTV-Android` و`clubTivi`. لا ندمج `M3UAndroid` أو `XtreamPulsar` مباشرة بسبب اختلاف الرخصة.
