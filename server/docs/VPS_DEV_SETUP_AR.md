# بيئة تطوير معزولة على VPS

هذا الإعداد يشغّل نسخة تطوير منفصلة عن الإنتاج. يستخدم مشروع Docker باسم `dzhoot-dev`، وقواعد بيانات ومساحات تخزين مستقلة، ويربط واجهات التطوير على `127.0.0.1` فقط. لا تستخدم ملفات الإنتاج أو بياناته.

## الخدمات

- لوحة الإدارة: `http://127.0.0.1:13001` على الخادم.
- API: `http://127.0.0.1:18009`.
- MongoDB وRedis وMongo Express وMailHog على منافذ محلية منفصلة.
- المجدول في ملف `manual` ولا يعمل افتراضيًا.
- يلزم نفق SSH لفتح اللوحة من جهاز آخر؛ لا تفتح منافذ التطوير للعامة.
- بناء Android واختباراته متاحان عبر GitHub Actions؛ لا حاجة لتثبيت Android SDK على خادم الإنتاج.

## ملف الأسرار

احفظ إعدادات التطوير في `/opt/dzhoot-dev/.env` خارج Git وبصلاحية `600`. يجب أن يحتوي على كلمات مرور تطوير منفصلة ومفاتيح عشوائية قوية: `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_CHANNEL_LIST_CODE`, `ME_CONFIG_BASICAUTH_USERNAME`, `ME_CONFIG_BASICAUTH_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PLAYBACK_TOKEN_SECRET`, `XTREAM_SECRET_KEY`, و`TOTP_ENCRYPTION_KEY` (64 خانة hexadecimal).

`ALLOW_INSECURE_DEV_SECRETS=1` موروث من إعداد التطوير في Compose ويُستخدم هنا فقط للخدمات المحلية. لا تفتح منافذ التطوير للعامة ولا تعِد استخدام أي سر إنتاجي.

## تشغيل وإيقاف

من مجلد `/opt/dzhoot-dev/source/server` شغّل الخدمات المطلوبة فقط:

```bash
docker compose -p dzhoot-dev --env-file /opt/dzhoot-dev/.env -f docker-compose.yml -f docker-compose.vps-dev.yml config --quiet
docker compose -p dzhoot-dev --env-file /opt/dzhoot-dev/.env -f docker-compose.yml -f docker-compose.vps-dev.yml up -d --build mongodb redis mongo-express mailhog api frontend
```

لإيقاف نسخة التطوير مع الاحتفاظ ببياناتها:

```bash
docker compose -p dzhoot-dev --env-file /opt/dzhoot-dev/.env -f docker-compose.yml -f docker-compose.vps-dev.yml down
```

لا تستخدم `down -v` إلا إذا أردت حذف قاعدة بيانات التطوير نهائيًا. لا تستخدم `docker-compose.production.yml` أو أوامر النشر لهذا الإعداد.
