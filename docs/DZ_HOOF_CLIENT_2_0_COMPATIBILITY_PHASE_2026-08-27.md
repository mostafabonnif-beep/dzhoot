# DZ HOOF Client 2.0 — حزمة التوافق والمراجعة

**التاريخ:** 2026-08-27  
**الفرع:** `manus/observability-foundation`  
**الحالة:** جاهزة للمراجعة الداخلية؛ لم تُدمج في `main` ولم تُنشر إلى VPS

## نتيجة فحص المستودع

تم تحديث مراجع Git والتحقق من أن فرع العمل متزامن مع فرع GitHub المقابل. آخر سلسلة Client 2.0 محفوظة، ولم توجد تغييرات غير محفوظة قبل بدء فحص التوافق.

## إصلاحات التوافق المطبقة

تم تصحيح قراءة سبب تنزيل APK في `AppUpdater` باستخدام `getColumnIndexOrThrow` حتى لا يمرر التطبيق فهرساً سالباً إلى Cursor. وتم تصحيح indentation في إعدادات التحكم. كما أضيفت صيغة AndroidX الصحيحة للتعامل مع استدعاءات Media3 غير المستقرة في مساري المشغل وVOD.

## نتائج الأدوات

| الفحص | النتيجة |
|---|---|
| Kotlin compilation | ناجح |
| `:app:testOfficialDebugUnitTest` | ناجح بعد إعادة التشغيل؛ الاختبار المعزول لـ`onResume` ناجح |
| `:app:lintOfficialDebug` | ناجح، 0 أخطاء و398 تحذيراً غير حاجب |
| `:app:assembleOfficialDebug` | ناجح |
| applicationId | `com.dzhoof.iptv` |
| label | `DZ HOOF TV` |
| versionName/versionCode | `1.0.18` / `10018` |
| APK signature verification | ناجح باستخدام v2؛ توقيع مراجعة داخلي |
| SHA-256 للـAPK الحالي | `a69b4016a467669aad5c795a8637419f67b9defb36445d0bd74ce67da2f09aee` |

## حدود الاختبار

بيئة العمل تحتوي Android SDK و`adb`، لكنها لا تحتوي Emulator ولا AVD ولا جهازاً متصلاً. لذلك لم يتم الادعاء باختبار D-pad أو اللمس أو تشغيل بث حي على جهاز فعلي. هذه الخطوة مطلوبة قبل إصدار `officialRelease` أو تفعيل التحديث العام.

## قرار النشر

الـAPK الحالي `officialDebug` للمراجعة الداخلية فقط. لم يُرفع إلى `/downloads`، ولم يُسجل في `AppVersion`، ولم يتغير Endpoint التحديث. بناء الإنتاج التالي يجب أن يستخدم `officialRelease` ومفتاح الإنتاج مع التحقق من الشهادة وSHA-256 واختبار نسخة قديمة على جهاز فعلي.
