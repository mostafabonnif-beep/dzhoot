# DZ HOOF Android Release Guide

هذا الدليل يشرح اختبار وإصدار تطبيق DZ HOOF على Android TV وFire TV. الإصدار النهائي يمر عبر workflow `android/.github/workflows/release.yml` بعد دفع tag يبدأ بـ`v`، بينما الإصدار المرشح اليدوي متاح في `.github/workflows/release-candidate.yml`.

## المتطلبات

| المتطلب | القيمة |
| --- | --- |
| Android Studio | إصدار حديث يدعم JDK 17 |
| JDK | 17 |
| compile SDK | 34 |
| min SDK | 28 |
| الجهاز | Android TV أو Fire TV متوافق |

## إعداد عنوان API

لا تعدّل المصدر لتغيير الخادم. مرّر عنوان HTTPS أثناء البناء:

```bash
cd android
./gradlew assembleDebug -PdzhoofApiUrl=https://tv.example.com/
# أو:
DZHOOF_API_URL=https://tv.example.com/ ./gradlew assembleDebug
```

يرفض Gradle عناوين HTTP. استخدم عنوانًا حقيقيًا قابلًا للوصول من الجهاز، ولا تستخدم `example.invalid` إلا للبناء المحلي الذي لا يهدف إلى التشغيل.

## Firebase وSentry

يُطبّق Firebase فقط عند وجود `app/google-services.json` أو ملف variant مناسب. لا ترفع الملف الحقيقي إلى Git إلا بعد مراجعته، ولا تضع keystore أو أسرار Sentry في المستودع. يمرر workflow الإصدار `SENTRY_DSN` و`SENTRY_AUTH_TOKEN` من GitHub Secrets عند توفرهما.

## البناء المحلي

```bash
cd android
./gradlew testDebugUnitTest --stacktrace
./gradlew assembleDebug --stacktrace
./gradlew assembleDev --stacktrace
```

المخرجات:

```text
app/build/outputs/apk/debug/app-debug.apk
app/build/outputs/apk/dev/app-dev.apk
app/build/outputs/apk/release/app-release.apk
```

إصدار release يتطلب متغيرات توقيع صالحة:

```bash
export SIGNING_KEY_STORE=/secure/path/dzhoof-release.keystore
export SIGNING_STORE_PASSWORD='...'
export SIGNING_KEY_ALIAS='...'
export SIGNING_KEY_PASSWORD='...'
./gradlew assembleRelease -PversionName=1.5.0
```

لا تحفظ كلمات المرور في shell history أو ملفات متتبعة. في GitHub Actions استخدم `ANDROID_KEYSTORE_BASE64` وحقول التوقيع كأسرار مستودع.

## الاختبار على الجهاز

```bash
adb connect <ANDROID_TV_IP>:5555
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.dzhoof.iptv/.ComposeMainActivity
adb logcat | grep -i dzhoof
```

نفّذ على الأقل الاختبارات التالية قبل الإصدار:

| المجال | النتيجة المطلوبة |
| --- | --- |
| الاقتران عبر PIN | يظهر PIN وتنتهي صلاحيته وتكتمل عملية الربط |
| الاتصال | يتصل التطبيق بعنوان HTTPS المحدد في BuildConfig |
| القنوات | تظهر القنوات والتصنيفات وتعمل HLS المعتمدة |
| التنقل | يعمل D-pad والرجوع والتركيز البصري |
| المفضلة | الإضافة والحذف والمزامنة تعملان |
| EPG وCatch-up | يظهران فقط عند توفر بيانات المصدر |
| الاشتراك | يمنع الخادم التشغيل بعد الانتهاء أو تجاوز حد الأجهزة |
| التحديث | يظهر الإصدار الجديد ويستخدم APK الموقّع الصحيح |

## الإصدار عبر GitHub

ارفع tag بعد مراجعة `versionCode` و`versionName`:

```bash
git tag -a v1.5.0 -m "DZ HOOF 1.5.0"
git push origin v1.5.0
```

سيتحقق workflow من الأسرار و`DZHOOF_API_URL`، يبني APK موقّعًا، يعيد تسميته إلى `dzhoof-1.5.0.apk`، ثم ينشئ GitHub Release ويرفعه. لا ترفع APK يدويًا إلى Git.

## أعطال شائعة

| المشكلة | الإجراء |
| --- | --- |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | أزل النسخة الموقعة بمفتاح مختلف ثم ثبّت النسخة الجديدة |
| التطبيق لا يصل إلى الخادم | افحص `BuildConfig.API_BASE_URL`، شهادة HTTPS، و`/health/ready` |
| القنوات فارغة | تحقق من مصدر M3U المصرح به ومن حالة المزامنة في الخادم |
| release لا يبدأ | راجع `ANDROID_KEYSTORE_BASE64` وأسرار التوقيع و`DZHOOF_API_URL` |
| التحديث لا يظهر | تحقق من tag واسم asset `dzhoof-<version>.apk` وإعدادات GitHub Release |
