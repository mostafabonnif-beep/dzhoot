# DZ HOOF — تقرير ترحيل package scopes

**التاريخ:** 2026-08-17

## القرار

تم ترحيل workspace package scopes الداخلية من `@firevision/*` إلى `@dzhoof/*` بدلاً من إبقاء الاسم القديم كحل مؤقت. شمل الترحيل manifests وimports وJest module mapping وDocker build commands وCI workflows و`server/package-lock.json`. كما تم تغيير اسم workspace الجذر من `firevision-iptv` إلى `dzhoof-iptv` ومواءمة metadata وNode engine مع Node 20.9+.

> الترحيل كان محدوداً إلى أسماء الحزم الداخلية. لم يُنفذ استبدال عام لعبارة `firevision-iptv` داخل قيم قواعد البيانات أو سجلات الترحيل، حتى لا تتغير أسماء قواعد موجودة أو migrations تاريخية دون خطة مستقلة.

## النطاق المتأثر

| المجال | النتيجة |
|---|---|
| Root workspace | `dzhoof-iptv` |
| Backend | `@dzhoof/backend` |
| Frontend | `@dzhoof/frontend` |
| Shared package | `@dzhoof/shared` |
| Imports وaliases | لا توجد مراجع نشطة لـ`@firevision/*` في server أو CI |
| npm lockfile | أُعيد توليده ولا يحتوي `@firevision/` |
| Docker | build commands تستخدم `@dzhoof/*` وNode 20 |
| GitHub Actions | workflows نُقلت من `server/.github` غير الفعال إلى `.github/workflows` الصحيح |
| CI guard | أُضيف `server/scripts/check-workspace-scopes.mjs` لمنع عودة الاسم القديم |

## التحقق

نجح guard المحلي، ونجح `npm ci --ignore-scripts` بعد إعادة توليد lockfile، كما نجحت `npm audit --omit=dev --audit-level=high` بدون vulnerabilities. نجحت اختبارات backend وعددها 27 suite و200 test، واختبارات frontend وعددها suiteان و5 tests، كما نجح build وlint للواجهة وbackend. نجح Android lint وunit tests وassembleDebug بعد الترحيل؛ لا يعتمد Android على هذه package scopes مباشرة.

تم تنظيف المراجع العامة التي كانت ستسبب التباساً للمشغّل، مثل روابط `tv.cadnative.com` وGitHub owner القديم في `llms.txt` وrobots وsitemap وprivacy وterms وAPI/architecture docs. أصبح sitemap قابلاً للضبط عبر `NEXT_PUBLIC_SITE_URL` أو `PUBLIC_BASE_URL` مع fallback إلى `https://ld-11.net`.

## مراجع تاريخية مقصودة

قد تظهر عبارة FireVision في تقارير تاريخية أو legal attribution أو أسماء ملفات قديمة لا تُحمّل كحزم ولا تؤثر على runtime. لا ينبغي إجراء استبدال شامل إضافي لها دون مراجعة سياق كل ملف. guard الجديد يركز على ما يسبب dependency regression فعلياً: manifests وimports وlockfiles وCI وDocker.

## ما يتطلب VPS

لا يمكن من sandbox تنفيذ Docker build فعلياً أو التحقق من صور GHCR أو اختبار `V4.1 matrix` من عنوان IP الإنتاجي. بعد شراء VPS، يجب تشغيل preflight، ثم Compose، ثم مقارنة curl وFFprobe وVLC وDZ HOOF من الخادم نفسه. هذا منفصل عن ترحيل package scopes.
