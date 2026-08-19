# DZ HOOF — تقرير قبول ما قبل VPS

**تاريخ الفحص:** 16 أغسطس 2026

**نطاق الفحص:** Backend وAndroid وLive TV وHLS ومسار التفعيل، قبل نقل الخدمة إلى VPS وربطها نهائياً مع `ld-11.net`.

## النتيجة التنفيذية

تم اجتياز فحص القبول المحلي بنجاح. النسخة الموحدة موجودة على الفرع `main`، والـ commit الأخير هو `9808ca1`، وهو متزامن مع `origin/main`. تم إصلاح أخطاء تجميع واختبارات Android، ثم تشغيل اختبارات Android وBackend بنجاح، وإعادة بناء APK تجريبي مهيأ للعمل مع عنوان Backend HTTPS الحالي.

> **القرار:** المشروع جاهز للانتقال إلى مرحلة إعداد VPS، لكنه ليس جاهزاً بعد للإطلاق التجاري النهائي قبل توفير VPS، وضبط أسرار الإنتاج، وإدخال مصادر محتوى مرخّصة والتحقق من تشغيلها فعلياً.

## نتائج التحقق

| المجال | النتيجة | التفاصيل |
|---|---:|---|
| Backend typecheck | ناجح | shared build وshared typecheck وbackend typecheck اكتملت دون أخطاء. |
| Backend unit/integration tests | ناجح | 26 test suites و187 اختباراً ناجحاً، دون failures أو errors. |
| Android unit tests | ناجح | 55 suite و441 حالة اختبار، دون failures أو errors. |
| APK debug build | ناجح | `assembleDebug` اكتمل بنجاح. حجم APK نحو 90 MB. |
| Backend health | ناجح | `/health/live` أعاد `status: ok`. |
| Activation flow | ناجح | redeem يولد `channelListCode` منفصلاً بطول 6 أحرف للمشغل التلفزيوني. |
| Customer catalog filtering | ناجح | القنوات من Xtream غير المتحقق منه والقنوات التي سجلت `isWorking=false` لا تظهر للعميل. |
| HTTPS playback | ناجح | الروابط العامة تحترم `x-forwarded-proto` و`x-forwarded-host` خلف Proxy. |
| HLS acceptance | ناجح | manifest ثم child playlist ثم أول TS segment أعادت HTTP 200 وبيانات صالحة. |
| Xtream verification lifecycle | ناجح | المصدر لا يصبح `verified/Active` ولا يدخل كتالوج العميل إلا بعد إثبات Live Playback فعلي. |

## إصلاحات Android المنفذة

تم تحديث الاختبارات التي كانت تعتمد على imports قديمة من MockK، وإضافة الاعتمادات الجديدة إلى `PlayerViewModelTest` و`SearchViewModelTest`، وتصحيح fixtures الخاصة بـ `Series`. كما تمت مواءمة assertions مع نصوص الواجهة العربية الحالية.

تم تحسين قابلية اختبار `AppUpdateViewModel` و`PairingViewModel` عبر حقن `IoDispatcher` بدلاً من استخدام `Dispatchers.IO` بشكل مباشر. وتمت حماية طلب Pairing من قيم `Build.MODEL` الفارغة في بيئة JVM، وتحسين قراءة رد JSON عبر Gson مع fallback واضح للقيم الناقصة. هذه التغييرات تقلل سباقات الاختبار وتحافظ على سلوك الإنتاج.

## APK الناتج

الملف الناتج هو:

`android/app/build/outputs/apk/debug/app-debug.apk`

تم تضمين عنوان Backend التالي داخل APK:

`https://3000-iqjm9mreut3wspli9dxce-cfee851e.us4.manus.computer/`

**SHA-256:** `4eace1fc42a3240544f3b9f4cb40d26b7fe40278ea8acb936be597cf84895360`

هذا APK مخصص للاختبار الحالي فقط، لأن عنوان Backend مؤقت. بعد تشغيل VPS يجب إعادة البناء بعنوان `https://ld-11.net` أو بعنوان API إنتاجي منفصل.

## GitHub

تم دفع جميع إصلاحات Android واختباراتها وRoom schema الجديدة إلى:

[merci1994dz/dzhoot](https://github.com/merci1994dz/dzhoot)

الفرع: `main`

الـ commit الأخير: `9808ca1 fix: stabilize android viewmodel tests`

## القيود الحالية قبل الإطلاق التجاري

بيئة Backend الحالية تعمل داخل Sandbox مع MongoMemoryServer وPublic tunnel مؤقتين؛ لذلك لا تصلح كبيئة إنتاج دائمة. يجب توفير VPS، إعداد MongoDB دائم وRedis عند الحاجة، وضع أسرار JWT وMongoDB وكلمات الإدارة في متغيرات إنتاج آمنة، وضبط reverse proxy وTLS وDNS للنطاق `ld-11.net`.

مصدر Xtream الذي تم اختباره سابقاً ينجح في المصادقة وجلب M3U، لكنه يفشل في Live Playback لدى المزود، ولذلك يبقى محجوباً عن العملاء وفق سياسة التحقق الجديدة. لا ينبغي استخدامه تجارياً، ولا ينبغي إدخال أي مصدر آخر إلا إذا كان مرخّصاً أو متاحاً بعقد B2B واضح ومثبت التشغيل.

## الخطوة التالية

بعد توفير بيانات VPS، تكون الخطوات التالية هي تهيئة النظام دون إعادة تثبيت المشروع: إنشاء ملف `.env.production` من النموذج، ضبط `PUBLIC_BASE_URL=https://ld-11.net`، تشغيل MongoDB وRedis وBackend عبر مسار التشغيل المستقر، تفعيل HTTPS، استيراد مصادر القنوات المرخّصة، إجراء اختبار تفعيل وAndroid TV وHLS بعد النشر، ثم بناء APK الإنتاج النهائي.
