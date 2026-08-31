# استضافة DZ HOOF ذاتيًا

هذا الدليل يشغّل DZ HOOF على خادم أو جهاز منزلي عبر `docker-compose.selfhost.yml`. للنشر العام مع HTTPS والنسخ الاحتياطي استخدم [دليل النشر الإنتاجي](DEPLOYMENT_GUIDE.md).

> مصادر القنوات مسؤولية المشغّل. أضف فقط مصادر M3U أو Xtream المصرح لك باستخدامها.

## المتطلبات

| المتطلب | القيمة |
| --- | --- |
| Docker | إصدار حديث مع Docker Compose Plugin |
| RAM | 2 GB حد أدنى، و4 GB أفضل |
| المنافذ المحلية | 3000 للـAPI و3001 للواجهة |
| Android TV / Fire TV | اختياري للاختبار |

## الحصول على المشروع

```bash
git clone https://github.com/merci1994dz/dzhoot.git
cd dzhoot/server
cp .env.example .env
chmod 600 .env
```

## إعداد البيئة

اضبط قيمًا مختلفة عن المثال، وولّد الأسرار عشوائيًا:

```env
NODE_ENV=production
APP_VERSION=0.0.0
DOCKER_IMAGE=ghcr.io/merci1994dz/dzhoot-server:latest
DOCKER_FRONTEND_IMAGE=ghcr.io/merci1994dz/dzhoot-frontend:latest

SUPER_ADMIN_USERNAME=admin
SUPER_ADMIN_PASSWORD=<strong-password-at-least-16-characters>
SUPER_ADMIN_EMAIL=admin@example.com

JWT_ACCESS_SECRET=<random-secret-at-least-32-characters>
JWT_REFRESH_SECRET=<different-random-secret-at-least-32-characters>
ALLOWED_ORIGINS=http://localhost:3001
APP_URL=http://localhost:3001

GH_APP_OWNER=merci1994dz
GH_APP_REPO=dzhoot
GH_APP_APK_PATTERN=dzhoof-*.apk
```

إذا لم تكن لديك صور GHCR خاصة بالمشروع بعد، استخدم صورًا منشورة من pipeline الخاص بك أو ابنِ الصور محليًا. لا تضع token أو كلمات المرور في Compose أو Git.

## التشغيل

تحقق من الملف أولًا ثم شغّل المكدس:

```bash
docker compose -f docker-compose.selfhost.yml config >/tmp/dzhoof-selfhost-config.yml
docker compose -f docker-compose.selfhost.yml up -d
docker compose -f docker-compose.selfhost.yml ps
```

الخدمات الحالية هي `dzhoof-api` و`dzhoof-frontend` و`dzhoof-mongodb` و`dzhoof-redis` و`dzhoof-scheduler`. MongoDB وRedis لا يُنشران على منافذ المضيف؛ لا تضف port mapping لهما في بيئة متصلة بالإنترنت.

راقب السجلات:

```bash
docker compose -f docker-compose.selfhost.yml logs -f --tail=200 api frontend
```

## التحقق

```bash
curl --fail-with-body http://localhost:3000/health/live
curl --fail-with-body http://localhost:3000/health/ready
curl --fail-with-body http://localhost:3001
```

افتح `http://localhost:3001`، سجّل دخول المشرف، أضف مصدرًا مصرحًا به، ثم اختبر القنوات والاقتران وEPG والتشغيل. لا تستخدم هذا الإعداد للإطلاق العام من دون HTTPS و`ALLOWED_ORIGINS` مقيدًا بنطاقك.

## ربط Android TV

ابنِ التطبيق بعنوان API الصحيح بدل تعديل المصدر:

```bash
cd ../android
./gradlew assembleDebug -PdzhoofApiUrl=http://<SERVER_IP>:3000/
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.dzhoof.iptv/.ComposeMainActivity
```

للجهاز البعيد استخدم عنوان LAN قابلًا للوصول من التلفاز. للإطلاق العام يجب استخدام HTTPS؛ إعداد Android يرفض عناوين HTTP في release builds.

## التشغيل والتحديث

```bash
docker compose -f docker-compose.selfhost.yml pull
docker compose -f docker-compose.selfhost.yml up -d
docker compose -f docker-compose.selfhost.yml ps
```

لا تحذف volumes أثناء التحديث. قبل أي ترقية، خذ نسخة من MongoDB، ثم راقب `/health/ready` والسجلات. للتراجع أعد الصورة إلى tag سابق وشغّل `up -d`.

## النسخ الاحتياطي

```bash
mkdir -p backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f docker-compose.selfhost.yml exec -T mongodb \
  mongodump --db=dzhoof-iptv --archive | gzip > "backups/mongodb-$STAMP.archive.gz"
gzip -t "backups/mongodb-$STAMP.archive.gz"
```

احتفظ بالنسخ خارج الجهاز واختبر استعادتها على قاعدة منفصلة. لا ترفع مجلد `backups` إلى Git.

## استكشاف الأخطاء

| المشكلة | الإجراء |
| --- | --- |
| API لا يبدأ | افحص `docker compose ... logs api` ومتغيرات الأسرار وMongoDB |
| الواجهة لا تصل إلى API | تحقق من proxy وعنوان backend و`ALLOWED_ORIGINS` |
| MongoDB مرفوض | استخدم اسم الخدمة `mongodb` داخل Compose، لا `localhost` |
| Redis غير متاح | استخدم `redis://redis:6379` داخل self-host compose؛ Redis اختياري لبعض الميزات |
| القنوات لا تعمل على التلفاز | استخدم عنوان IP أو HTTPS قابلًا للوصول، لا `localhost` |
| APK لا يظهر له تحديث | راجع GitHub Release و`GH_APP_OWNER` و`GH_APP_REPO` وpattern asset |
