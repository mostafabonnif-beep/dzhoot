# تحضير APK Release وتوقيع تطبيق DZ HOOF Android TV

## الخلاصة

يحتاج إصدار Release إلى ثلاثة أشياء مستقلة: **خادم دائم HTTPS**، **ملف Firebase حقيقي إن كانت خدمات Firebase مفعّلة**، و**مفتاح توقيع Android محفوظ بأمان**. لا يجب رفع Keystore أو كلمات المرور أو `google-services.json` الحقيقي إلى GitHub كمصدر عادي.

تم تجهيز المشروع ليبني Debug تلقائيًا على فروع التطوير، ويبني Release موقّعًا فقط عند تشغيل Workflow يدويًا مع تفعيل خيار Release وتوفير الأسرار المطلوبة.

## البيانات المطلوبة من صاحب المشروع

| البيانات | مثال شكلي | هل تُحفظ سرًا؟ |
|---|---|---:|
| النطاق الدائم للـAPI | `https://iptv.example.com/` | لا، لكنه يجب أن يكون HTTPS |
| `versionCode` | `6` | لا |
| `versionName` | `1.6.0` | لا |
| ملف Keystore | `release.keystore` أو `release.jks` | نعم |
| كلمة مرور Keystore | نص سري | نعم |
| اسم المفتاح `keyAlias` | `dzhoof-release` | يُفضل اعتباره سريًا |
| كلمة مرور المفتاح | نص سري | نعم |
| `google-services.json` | ملف Firebase الخاص بـ`com.dzhoof.iptv` | حساس ويجب ألا يُرفع إلى Git |
| Android Sentry DSN | اختياري | سر/إعداد خاص |

لا ترسل كلمة مرور Keystore أو المفتاح الخاص داخل رسالة عادية. يمكن تجهيز الملفات محليًا ثم تحويلها إلى GitHub Secrets، أو رفعها عبر قناة آمنة يحددها صاحب المشروع.

## إنشاء Keystore جديد

إذا لم يكن هناك Keystore تجاري سابق للتطبيق، يُنشأ مرة واحدة فقط. يجب الاحتفاظ بنسخة مشفرة منه في مدير كلمات مرور أو تخزين آمن مستقل عن GitHub:

```bash
keytool -genkeypair \
  -v \
  -keystore dzhoof-release.keystore \
  -alias dzhoof-release \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -storepass 'CHANGE-ME-STORE-PASSWORD' \
  -keypass 'CHANGE-ME-KEY-PASSWORD' \
  -dname 'CN=DZ HOOF, OU=Mobile, O=DZ HOOF, L=DZ, ST=Algeria, C=DZ'
```

يجب استبدال القيم التجريبية قبل التنفيذ. لا تفقد هذا الملف أو كلمات المرور؛ توقيع تحديثات Android المستقبلية يجب أن يستخدم نفس المفتاح حتى يقبلها النظام كتحديث للتطبيق الحالي.

## Firebase

إذا كان Firebase مستخدمًا في الإصدار التجاري، يجب إنشاء أو اختيار مشروع Firebase وربط تطبيق Android بالمعرّف:

```text
com.dzhoof.iptv
```

بعد تنزيل `google-services.json`، يجب التأكد من أنه يخص نفس `applicationId`، ثم حفظ محتواه كسر GitHub باسم `ANDROID_GOOGLE_SERVICES_JSON_BASE64`. لا نضع الملف في المستودع، ولا نضعه داخل APK كمصدر يمكن للمستخدم قراءته خارج طبيعة إعدادات Firebase العامة.

## GitHub Secrets المطلوبة

تُضاف الأسرار من إعدادات المستودع في **Settings → Secrets and variables → Actions → New repository secret**:

| اسم السر | القيمة |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | محتوى Keystore بعد تحويله إلى Base64 |
| `SIGNING_STORE_PASSWORD` | كلمة مرور ملف Keystore |
| `SIGNING_KEY_ALIAS` | اسم المفتاح داخل Keystore |
| `SIGNING_KEY_PASSWORD` | كلمة مرور المفتاح |
| `ANDROID_GOOGLE_SERVICES_JSON_BASE64` | محتوى `google-services.json` بعد Base64 |
| `ANDROID_SENTRY_DSN` | اختياري، إذا أردنا Sentry في التطبيق |

لتحويل الملفات إلى Base64 محليًا:

```bash
base64 -w 0 dzhoof-release.keystore > release-keystore.base64.txt
base64 -w 0 google-services.json > google-services.base64.txt
```

يجب حذف ملفات Base64 المؤقتة بعد إضافتها إلى GitHub Secrets أو حفظها في مكان مشفر. لا تُرسل محتوياتها إلى Git أو إلى سجل CI.

## إعداد عنوان API

لا ينبغي بناء Release على رابط Manus المؤقت أو `localhost` أو `example.invalid`. بعد الحصول على النطاق الدائم، يتم تمريره إلى Workflow مثل:

```text
https://iptv.example.com/
```

المشروع يفرض HTTPS ويرفض روابط `manus.computer` والروابط الوهمية أثناء مهمة Release. عند تغيير IP أو مزود VPS فقط، يبقى APK صالحًا لأن التطبيق يتصل بالنطاق وليس بعنوان IP.

## تشغيل البناء

بعد إضافة الأسرار، افتح تبويب **Actions** ثم Workflow باسم `CI` واختر **Run workflow** على فرع الميزة. أدخل النطاق الدائم، فعّل `Build and upload a signed Android Release APK`، ثم حدّد `versionCode` و`versionName`.

سينفذ CI الخطوات التالية: إعداد Java 17 وAndroid SDK، فك Firebase وKeystore داخل بيئة مؤقتة، تشغيل `assembleRelease` مع `minifyEnabled` و`shrinkResources`، التحقق من التوقيع عبر `apksigner`، حساب SHA-256، ثم رفع APK كـArtifact. لا يتم رفع Keystore أو كلمات المرور أو `google-services.json` إلى Artifact.

## ما يجب فحصه قبل تسليم APK

يجب تثبيت APK على Samsung S22 واختبار التفعيل بالكود، تسجيل الدخول الداخلي، ظهور المحتوى، بدء التشغيل، انتهاء الاشتراك، حد الأجهزة، الرسائل العربية، وإخفاء مصادر القنوات. كما يجب اختبار Android TV باستخدام D-pad والتركيز والعودة والوضع الأفقي قبل استخدام الإصدار مع العملاء.

## ملاحظة مهمة عن الإصدار الحالي

تم تجهيز ملفات Gradle وCI، لكن لا يمكن إنتاج APK Release تجاري الآن قبل توفر **النطاق الدائم** و**Keystore** و**Firebase `google-services.json`**. يمكن بناء Debug بالرابط المؤقت للفحص، أما Release فيجب أن يوجه إلى نطاق دائم منذ البداية.
