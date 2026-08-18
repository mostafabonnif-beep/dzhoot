# إعداد خادم DZ HOOF محليًا

هذا الدليل مخصص للتطوير والاختبار المحلي. للنشر العام استخدم [دليل النشر الإنتاجي](DEPLOYMENT_GUIDE.md)، وللاستضافة الذاتية استخدم [دليل SELF-HOSTING](SELF_HOSTING_GUIDE.md).

## المتطلبات

| الأداة | الإصدار |
| --- | --- |
| Docker وDocker Compose | إصدار حديث |
| Node.js | 20 أو أحدث عند التشغيل خارج Docker |
| Git | 2 أو أحدث |

## التشغيل السريع عبر Docker

```bash
git clone https://github.com/merci1994dz/dzhoot.git
cd dzhoot/server
cp .env.example .env
# راجع SUPER_ADMIN_* وME_CONFIG_MONGODB_BASICAUTH_PASSWORD في .env
docker compose up -d
docker compose ps
```

الخدمات المحلية الأساسية:

| الخدمة | العنوان |
| --- | --- |
| API | `http://localhost:8009` |
| Frontend | `http://localhost:3001` |
| MongoDB | `127.0.0.1:27017` فقط |
| Redis | `127.0.0.1:6379` فقط |
| Mongo Express | `http://localhost:8081` فقط |
| MailHog | `http://localhost:8025` فقط |

لا تفتح منافذ MongoDB وRedis وMongo Express للعامة. القيم الافتراضية للتطوير ليست صالحة للإنتاج.

## التحقق والإدارة

```bash
curl --fail-with-body http://localhost:8009/health/live
curl --fail-with-body http://localhost:8009/health/ready
docker compose logs -f --tail=200 api frontend
```

يفتح المستخدم لوحة الإدارة من `http://localhost:3001`. يُنشأ المشرف الأول من `SUPER_ADMIN_USERNAME` و`SUPER_ADMIN_PASSWORD` و`SUPER_ADMIN_EMAIL`. إذا احتجت إلى إعادة ضبط كلمة المرور للتطوير، استخدم `FORCE_UPDATE_ADMIN_PASSWORD=true` مرة واحدة ثم أعدها إلى `false`.

## التشغيل خارج Docker

شغّل MongoDB وRedis محليًا أو عبر Compose، ثم ثبّت الحزم وابنِ الحزمة المشتركة:

```bash
npm ci
npm run build -w @dzhoof/shared
npm run dev -w @dzhoof/backend
npm run dev -w @dzhoof/frontend
```

عند التشغيل المحلي المباشر، استخدم `MONGODB_URI=mongodb://localhost:27017/dzhoof-iptv` و`REDIS_URL=redis://localhost:6379`، ولا تستخدم `localhost` داخل حاوية Docker؛ داخل Compose يجب استخدام أسماء الخدمات `mongodb` و`redis`.

## إنشاء مستخدم واختبار API

سجّل الدخول من الواجهة أو نفّذ:

```bash
curl -X POST http://localhost:8009/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<local-password>"}'
```

استخدم `X-Session-Id` الذي يرجعه الخادم في طلبات الإدارة. لا تحفظ session ID في ملفات أو سجلات عامة.

## إضافة مصدر وقنوات

أضف مصدر M3U مصرحًا به من لوحة الإدارة، ثم اختبر:

```bash
curl --fail-with-body http://localhost:8009/api/v1/channels
curl --fail-with-body http://localhost:8009/api/v1/epg/stats
```

تُخزّن أكواد القنوات كبيانات حاملة للصلاحية. لا تنشرها في issues أو screenshots أو logs.

## الاختبارات والبناء

```bash
npm run typecheck
npm run lint
npm run test:backend
npm run test:frontend
npm run build:backend
npm run build -w @dzhoof/frontend
npm audit --omit=dev --audit-level=high
```

اختبار Android:

```bash
cd ../android
./gradlew testDebugUnitTest
./gradlew assembleDebug -PdzhoofApiUrl=http://<SERVER_IP>:8009/
```

## استكشاف الأخطاء

| المشكلة | الإجراء |
| --- | --- |
| API لا يبدأ | `docker compose logs api mongodb` ثم افحص `.env` و`/health/ready` |
| Frontend لا يتصل | تحقق من `NEXT_PUBLIC_API_URL` وproxy، ثم أعد بناء الحاوية |
| MongoDB connection refused | استخدم `mongodb` داخل Docker أو `localhost` خارج Docker |
| Redis connection refused | استخدم `redis` داخل Docker أو `localhost` خارج Docker |
| المشرف غير موجود | تحقق من `SUPER_ADMIN_*` ثم راجع سجلات `api` |
| اختبار MongoDB يفشل عند التنزيل | أعد المحاولة بعد حذف cache الاختبار التالف؛ لا تعطّل MD5 في CI الإنتاجي |

## وثائق مرتبطة

- [API Documentation](./API_DOCUMENTATION.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Self-hosting Guide](./SELF_HOSTING_GUIDE.md)
- [Architecture](./ARCHITECTURE.md)
- [TV Pairing System](./TV_PAIRING_SYSTEM.md)
