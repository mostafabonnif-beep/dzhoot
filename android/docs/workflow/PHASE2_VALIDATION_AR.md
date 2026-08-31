# المرحلة 2 — تثبيت تطبيق Android TV

## نطاق القبول

يُعد تطبيق DZ HOOF جاهزًا لمرحلة التثبيت عندما يُبنى من المصدر بالـpackage ID `com.dzhoof.iptv`، ويتلقى عنوان الخادم عبر `dzhoofApiUrl` أو `DZHOOF_API_URL`، ويعمل محليًا دون ملف Firebase حقيقي، ثم يفعّل Firebase تلقائيًا عند توفير `google-services.json` المطابق.

| المجال | معيار القبول |
|---|---|
| الهوية | `applicationId` و`namespace` يساويان `com.dzhoof.iptv`، واسم التطبيق الظاهر هو DZ HOOF IPTV. |
| API | لا توجد قيمة خادم حقيقية داخل المصدر؛ البناء يتطلب HTTPS، والقيمة الافتراضية `https://example.invalid/` مخصصة للاختبارات فقط. |
| Firebase | `FIREBASE_ENABLED` يُولد وقت البناء. يعمل Debug/Dev بدون `google-services.json`، ويُفعل Analytics وCrashlytics وFCM عند توفير ملف صحيح. |
| Live TV | يمكن للمستخدم إتمام PIN/QR، تحميل القنوات، فتح المشغل، تبديل القنوات، حفظ المفضلة، وقراءة EPG. |
| Android TV | يدعم D-pad، يعيد التركيز بعد الرجوع من المشغل، ويعرض المفضلة والقنوات الصحية أولًا. |
| اللغة | رسائل التشغيل والـoffline والـdegraded وشاشة تفاصيل المسلسل عربية وقابلة للعرض RTL. |

## البناء المحلي

```bash
cd android
./gradlew lintDebug testDebugUnitTest assembleDebug \
  -PdzhoofApiUrl=https://example.invalid/
```

لربط نسخة اختبار بخادم مصرح به:

```bash
DZHOOF_API_URL=https://tv.example.com/ ./gradlew assembleDebug
```

يجب ألا يُستخدم `http://`، ولا تُحفظ قيمة الخادم الحقيقية أو أي ملف Firebase أو keystore داخل Git.

## Firebase وRelease

أنشئ تطبيق Android في Firebase بالمعرف `com.dzhoof.iptv` ثم ضع `google-services.json` محليًا في `android/app/` أو مرره إلى workflow كسرّ `GOOGLE_SERVICES_JSON_BASE64`. يتحقق workflow من وجود package ID المطابق ويحذف الملف بعد البناء. يتطلب Release الأسرار الأربعة الخاصة بالتوقيع، بالإضافة إلى `api_url` بصيغة HTTPS.

## اختبار الجهاز أو Emulator

على Android TV أو Fire TV، تحقق من إظهار التطبيق ضمن Leanback Launcher، ثم نفذ pairing عبر PIN وQR، افتح القنوات، بدّل بين قناتين، اختبر المفضلة وEPG، افصل مصدرًا أو API مؤقتًا وتحقق من الرسالة العربية، ثم أعد الدخول إلى شاشة القنوات وتأكد من استعادة التركيز على القناة السابقة.

لا يمكن اعتبار APK Release موقّعًا أو اختبار المشاهدة الفعلية مكتملًا من بيئة لا تحتوي Android SDK أو جهاز TV؛ لذلك ينفذ CI البناء والاختبارات، ويجب تنفيذ اختبار التشغيل النهائي على Emulator أو جهاز فعلي قبل النشر العام.
