# DZ HOOF — تقرير الجاهزية قبل VPS

**التاريخ:** 2026-08-17

## الخلاصة التنفيذية

أُنجزت جولة تدقيق وإصلاح شاملة للأعمال التي يمكن تنفيذها قبل امتلاك VPS. لم يبدأ V5، ولم تتم إضافة cache أو bypass أو أي منطق لتجاوز قيود مزود المحتوى. النتيجة الحالية هي أن المشروع **جاهز للانتقال إلى اختبار VPS فعلي من ناحية الكود والاختبارات المحلية**، لكنه ليس مثبتاً بعد كإطلاق إنتاجي لأن Docker غير متوفر في sandbox ولا يمكن تنفيذ اختبار same-VPS أو إثبات صلاحية المصدر الخارجي قبل توفر الخادم.

> لا تعني الجاهزية المحلية أن Lynx أو أي مزود آخر سيقبل إعادة البث. هذا يُحسم فقط بتجربة مستقلة من عنوان IP الخاص بـVPS وبمصدر مصرح بإعادة البث.

## الإصلاحات المنفذة

| المجال | ما تم إصلاحه |
|---|---|
| Docker/Next.js | تم تحويل صور backend وfrontend وبيئات التطوير من Node 18 إلى Node 20. Next.js الحالي يعلن متطلب Node 20.9 أو أحدث، وCI يعمل على Node 20. |
| Android lint | تم إصلاح خطأ indentation وخمسة استعمالات Media3 غير معلنة بـ`androidx.annotation.OptIn`. أصبح `abortOnError=true` و`checkReleaseBuilds=true`. |
| Android playback | أصبح `ErrorRecoveryManager.activeStreamUrl` يعكس رابط proxy الفعلي أثناء fallback، مع regression test مستقل. |
| Relay | تم إبقاء إصلاح URL resolution النسبي في HLS، وإصلاح خطأ `prefer-const` في upstream relay. |
| Production workflow | نُقل docker-publish workflow من `server/.github/workflows` غير المقروء تلقائياً إلى `.github/workflows` الصحيح، وصُححت مسارات Docker وCompose. |
| GHCR/Portainer | تم توحيد أسماء الصور إلى `ghcr.io/merci1994dz/dzhoof-iptv-server` ونسخة frontend التابعة لها، وتوحيد اسم stack إلى `dzhoof_prod` والشبكة إلى `dzhoof-shared-network`. |
| Secrets/deploy | أضيف تمرير domain وHTTPS وJWT وXtream وPlayback وTOTP secrets، مع guard يمنع deploy إذا كانت المتغيرات الأساسية ناقصة أو بقيت placeholders. |
| Compose | أصبحت `SUBSCRIPTION_REQUIRED` مطلوبة صراحة في production بدلاً من default خفي. |
| إدارة الخادم | تم إصلاح قاعدة البيانات من `firevision-iptv` إلى `dzhoof-iptv`، وإصلاح port/API URLs، وإزالة تحميل `.env` عبر `xargs`، وتوليد مفاتيح XTREAM وPLAYBACK وTOTP أثناء setup. |
| فحص النشر | تم إنشاء `server/scripts/preflight-production.sh` لفحص permissions وHTTPS وsecrets وCompose دون طباعة القيم الحساسة أو تشغيل الخدمات. |
| test-deployment | أُزيل domain القديم وX-API-Key غير المدعوم، وأُصلح bug عدادات Bash مع `set -e`، وأصبح `SERVER_URL` مطلوباً بدلاً من اختبار نطاق قديم تلقائياً. |
| الوثائق | تم تحديث README وMakefile وrunbooks وOAuth callbacks والصور وdomain references لتطابق DZ HOOF و`ld-11.net`. |

## نتائج الاختبارات

| الاختبار | النتيجة |
|---|---:|
| Backend lint | PASS؛ توجد تحذيرات `no-explicit-any` legacy فقط، ولا توجد أخطاء lint مانعة. |
| Backend build/typecheck | PASS |
| Backend Jest | 27 suites / 200 tests — PASS |
| Frontend lint/build | PASS |
| Frontend Jest | 2 suites / 5 tests — PASS |
| Android lintDebug | PASS بعد إصلاح الأخطاء؛ بقيت warnings غير مانعة فقط. |
| Android unit tests | PASS بعد إعادة التشغيل؛ full suite ناجح. |
| Android assembleDebug | PASS؛ تم إنتاج APK debug محلياً. |
| Shell syntax/diff check | PASS |
| Docker Compose/build محلياً | لم يُنفذ: Docker غير مثبت داخل sandbox. |
| اختبار VPS الإنتاجي | لم يُنفذ: لا توجد بيانات اتصال VPS في الجلسة. |

## ما بقي فعلاً قبل الإطلاق

المتبقي ليس إصلاحاً عشوائياً داخل التطبيق. عند شراء VPS يجب تنفيذ أربع خطوات تشغيلية: تشغيل preflight على VPS، بناء/سحب صور GHCR بعد نجاح workflow، تشغيل `docker-compose.production.yml` مع domain وsecrets حقيقية، ثم تنفيذ V4.1 matrix من نفس الخادم باستخدام curl وFFprobe وVLC وDZ HOOF.

أما مصدر القنوات، فيجب أن يكون مصدراً مصرحاً بإعادة البث. إذا فشلت الأدوات الأربع المستقلة من VPS، فالمشكلة في وصول المصدر أو سياسة المزود، ولا يحلها تغيير Android أو إضافة cache. إذا نجحت الأدوات المستقلة وفشل relay فقط، عندها يكون منطقياً فتح إصلاح جديد محدود داخل DZ HOOF.

توجد ديون تنظيف غير مانعة للإطلاق، أهمها بقاء بعض package scopes الداخلية مثل `@firevision/*` وبعض أسماء ملفات الوثائق القديمة. لم أغيّرها آلياً لأن تغييرها يتطلب تحديث workspace وpackage-lock وجميع imports، وقد يسبب regression بلا فائدة تشغيلية مباشرة. الواجهة والعمليات والوثائق العامة التي يراها المشغّل أصبحت DZ HOOF.

## ترتيب التنفيذ على VPS

```bash
cd /opt/dzhoot/server
chmod 600 .env.production
./scripts/preflight-production.sh

docker compose --env-file .env.production \
  -f docker-compose.production.yml config >/tmp/dzhoof-production-config.yml

docker compose --env-file .env.production \
  -f docker-compose.production.yml up -d

curl --fail-with-body https://ld-11.net/health/live
curl --fail-with-body https://ld-11.net/health/ready
```

بعد ذلك تُشغّل مصفوفة التشخيص من نفس الخادم فقط، ولا تُرسل كلمات مرور أو ملفات M3U خام داخل المحادثة أو Git. تُحفظ artifacts في directory بصلاحيات مقيدة وتُستخدم مخرجات منزوعة الأسرار.

## القرار الصريح

**لا يوجد الآن عائق كودي محلي يمنع شراء VPS لتجربة V4.1.** شراء VPS سيضيف دليلاً جديداً فقط: هل عنوان IP والشبكة يسمحان بالوصول إلى media bytes أم لا. لا يمكن إكمال هذه النقطة من sandbox، ولا ينبغي الادعاء بحلها قبل الاختبار الفعلي.
