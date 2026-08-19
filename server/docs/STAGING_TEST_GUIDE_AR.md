# دليل تجربة الإصدار الاحترافي v1.0.0

## قاعدة السلامة

> **لا تشغّل فرع `release/professional-v1` على خادم الإنتاج الحالي مباشرةً للتجربة.** ملف الإنتاج يستخدم أسماء حاويات ومنافذ وvolumes مخصصة للخدمة الحية. اختبره أولاً على حاسوبك أو على خادم تجريبي منفصل.

## 1. مراجعة التغييرات على GitHub

افتح الفرع التالي وراجع التغييرات قبل الدمج:

```text
https://github.com/merci1994dz/dzhoot/tree/release/professional-v1
```

أهم التغييرات موجودة في:

| الملف | الغرض |
|---|---|
| `server/Caddyfile` | ترويسات حماية ومسارات صحة إضافية. |
| `server/docker-compose.production.yml` | فحوص صحة وموارد واضحة للخدمات. |
| `server/scripts/preflight-production.sh` | منع إعدادات إنتاج ناقصة أو غير آمنة. |
| `server/docs/PROFESSIONAL_RELEASE_V1_AR.md` | معيار اعتماد الإصدار وخطة الاسترجاع. |

## 2. تجربة تطوير محلية على حاسوب منفصل

هذه الطريقة مخصصة للتأكد من الواجهة وAPI وقاعدة البيانات دون نطاق عام أو بيانات حقيقية.

```bash
git clone https://github.com/merci1994dz/dzhoot.git
cd dzhoot
git switch release/professional-v1
cd server
cp .env.example .env
# عدّل فقط بيانات التطوير المحلية داخل .env
chmod 600 .env
docker compose up --build
```

بعد اكتمال الحاويات، افتح لوحة الإدارة على العنوان الذي يحدده ملف Compose التطويري، ثم اختبر تسجيل الدخول وإضافة مصدر M3U **مرخّص تجريبي فقط** وعرض قناة واحدة وربط جهاز تجريبي.

لإيقاف البيئة وحذف بياناتها التجريبية فقط:

```bash
docker compose down -v
```

## 3. تجربة إنتاجية معزولة على خادم أو VM مستقل

استخدم آلة تجريبية مختلفة عن الخادم الحالي. جهّز نطاقاً فرعياً منفصلاً مثل `staging.example.com`، ولا تستخدم `iptv.ld-11.net` في هذه المرحلة.

```bash
git clone https://github.com/merci1994dz/dzhoot.git /opt/dzhoot-staging
cd /opt/dzhoot-staging
git switch release/professional-v1
cd server
cp .env.production.example .env.production
chmod 600 .env.production
```

اضبط في `.env.production` ما يلي قبل أي تشغيل:

| الإعداد | مثال تجريبي |
|---|---|
| `APP_VERSION` | `1.0.0-rc.1` |
| `DOMAIN` | `staging.example.com` |
| `APP_URL` و`PUBLIC_BASE_URL` | `https://staging.example.com` |
| `ALLOWED_ORIGINS` | `https://staging.example.com` |
| `DOCKER_IMAGE` و`DOCKER_FRONTEND_IMAGE` | صور مبنية ومثبتة بوسم RC أو digest، وليس `latest` |
| الأسرار | قيم جديدة مستقلة تماماً عن الإنتاج |

أنشئ الشبكة الخارجية المطلوبة إذا لم تكن موجودة، ثم تحقق من الإعداد **قبل** تشغيل الخدمات:

```bash
docker network create dzhoof-shared-network 2>/dev/null || true
npm ci
npm run release:check
npm run validate:production
docker compose --env-file .env.production -f docker-compose.production.yml config
```

بعد نجاح هذه الأوامر فقط، شغّل البيئة التجريبية ثم تحقق من الصحة:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d
curl --fail --silent https://staging.example.com/health/live
curl --fail --silent https://staging.example.com/health/ready
```

## 4. قائمة اختبار القبول

| المسار | النتيجة المطلوبة |
|---|---|
| صفحة الدخول وإنشاء الحساب | تعمل عبر HTTPS ولا تظهر أخطاء في المتصفح. |
| API health | `/health/live` و`/health/ready` يعيدان 200. |
| إدارة القنوات | إضافة وعرض قناة مرخّصة تجريبية فقط. |
| التشغيل | قناة واحدة تعمل دون ظهور رابط المصدر الأصلي للمستخدم. |
| EPG | ظهور دليل البرامج لقناة الاختبار عند وجود XMLTV صالح. |
| الربط | ربط جهاز Android TV تجريبي ثم إلغاء الربط. |
| الصلاحيات | مستخدم عادي لا يصل لمسارات الإدارة. |
| الاسترجاع | إنشاء نسخة MongoDB والتحقق من SHA-256 قبل الانتقال للإنتاج. |

## 5. الانتقال إلى الإنتاج

لا تنتقل إلى النطاق الحي إلا عندما تنجح قائمة القبول كاملة ويُراجع digest الصورة السابق والجديد وتوجد نسخة MongoDB حديثة ومختبرة. لا تدمج الفرع في `main` ولا تغيّر الحاويات الحية قبل موافقة صريحة على خطة النشر والاسترجاع.
