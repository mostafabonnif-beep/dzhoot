# DZ HOOF — Firebase setup

## الوضع الحالي

تكامل Firebase في تطبيق Android اختياري حتى يبقى البناء المحلي قابلًا للتشغيل قبل وصول مشروع Firebase المستقل وملف `google-services.json`. يفعّل Gradle إضافات Google Services وCrashlytics وPerformance فقط عندما يجد ملف إعداد Firebase في أحد المسارات المدعومة.

عند غياب الملف، تكون قيمة `BuildConfig.FIREBASE_ENABLED` هي `false`، ويستمر التطبيق في العمل من دون محاولة الحصول على FCM token. وعند وجود الإعداد الصحيح، يستخدم التطبيق Firebase Cloud Messaging لتخزين أحدث token محليًا ثم يرسله ضمن مسار تسجيل الجهاز بعد المصادقة.

## هوية التطبيق المطلوبة

| الحقل | القيمة |
|---|---|
| اسم العرض | DZ HOOF |
| Package name | `com.dzhoof.iptv` |
| Application ID | `com.dzhoof.iptv` |
| النطاق المرتبط | `ld-11.net` |
| الحد الأدنى | Android API 28 |

عند إنشاء تطبيق Android داخل Firebase، يجب إدخال **`com.dzhoof.iptv` حرفيًا**. لا تستخدم اسم الحزمة القديم أو اسمًا مختلفًا للـdebug؛ فـ`dev` يضيف suffix إلى `applicationId` داخل Gradle، بينما ملف Firebase الأساسي يجب أن يطابق تطبيق release.

## التثبيت المحلي

بعد إنشاء مشروع Firebase وتسجيل تطبيق Android، نزّل `google-services.json` وضعه مؤقتًا في:

```text
android/app/google-services.json
```

ويمكن أيضًا استخدام إعداد منفصل للـdebug أو release في:

```text
android/app/src/debug/google-services.json
android/app/src/release/google-services.json
```

الملف مستثنى من Git عبر قاعدة `**/google-services.json`. لا ترفعه إلى GitHub ولا تضع محتواه في ملفات Markdown أو السجلات.

## الوظائف المجهزة

التطبيق يملك خدمة `DzHoofFirebaseMessagingService` التي تحفظ آخر FCM token دون تسجيله في Logcat. ويفحص `SubscriptionRepositoryImpl` قيمة `BuildConfig.FIREBASE_ENABLED` قبل طلب token، لذلك لا يفشل البناء أو تسجيل الجهاز في بيئات التطوير التي لا تحتوي إعداد Firebase.

إضافات Firebase الموجودة في Gradle تدار عبر Firebase BoM، وتشمل Analytics وMessaging وCrashlytics وPerformance وDatabase وFirestore. تفعيل الخدمات الفعلية يجب أن يتم تدريجيًا بعد مراجعة مشروع Firebase، ولا ينبغي استخدام Database أو Firestore قبل تحديد قواعد أمان مناسبة.

## إعداد GitHub Actions

يستخدم workflow الخاص بـRelease Candidate السر `GOOGLE_SERVICES_JSON_BASE64`. لإنشاء القيمة من ملف محلي، استخدم جهازك أو بيئة CI آمنة:

```bash
base64 -w0 android/app/google-services.json
```

احفظ الناتج في GitHub Actions Secrets باسم `GOOGLE_SERVICES_JSON_BASE64`. يقوم workflow باستعادة الملف مؤقتًا، ويتحقق من وجود:

```json
"package_name": "com.dzhoof.iptv"
```

ثم يحذف الملف بعد البناء. لا تضع محتوى الملف في GitHub Variables أو داخل commit عادي.

## خطوات ما بعد موافقة Google

بعد وصول موافقة زيادة حصة المشاريع، أنشئ مشروعًا مستقلًا باسم **DZ HOOF**، ثم أضف تطبيق Android بالحزمة الصحيحة ونزّل `google-services.json`. بعدها يمكن تشغيل `assembleDebug` و`assembleRelease` على CI، ثم تسجيل جهاز Android TV فعلي واختبار وصول FCM وتسجيل token في مسار الاشتراك.

يظل البناء المحلي واختبارات JVM دون Firebase مدعومين عمدًا. أما `Android Release` و`Release Candidate` على GitHub Actions فيتطلبان الآن السر `GOOGLE_SERVICES_JSON_BASE64` حتى لا يخرج APK تسويقي بدون FCM وCrashlytics.

**ملاحظة أمنية:** ملف Firebase ليس بديلًا عن أسرار التوقيع أو مفاتيح Backend. يجب حفظ Keystore وأسرار التوقيع وبيانات الخادم في GitHub Secrets أو مدير أسرار مناسب، وعدم إرسالها داخل المحادثة.
