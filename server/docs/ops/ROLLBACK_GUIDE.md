# DZ HOOF — Rollback Guide (audit-remediation-v1)

الهدف: استرجاع النظام لحالة تشغيلية سابقة بأمان عند حدوث تراجع (regression) بعد نشر
نسخة جديدة. تنطبق على خادم Docker Compose واحد.

## المبادئ

1. **لا ترمِ النسخة القديمة قبل التأكد** — احتفظ بآخر صور Docker تعمل (`dzhoof-api:OLD`،
   `dzhoof-frontend:OLD`) لمدة 14 يومًا على الأقل.
2. **قاعدة البيانات لا تُرجَع عادةً** — النسخ الاحتياطية للبيانات (mongodump) مخصصة
   للكوارث. التراجع عن كود لا يتطلب استرجاع قاعدة البيانات إلا إذا غيّر التحديث
   مخطط (schema) بطريقة غير متوافقة مع الكود القديم.
3. **تحقق من النسخ الاحتياطية قبل كل نشر** — شغّل
   `./scripts/backup/verify-backup.sh /var/backups/dzhoot/mongodb/<STAMP>/dzhoof-iptv.archive.gz`.

## خطوات التراجع (Rollback)

```bash
# 1) سجّل الإصدار الحالي قبل أي شيء
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}'

# 2) (كوارث فقط) استرجاع قاعدة البيانات من أحدث نسخة موثقة
docker exec -i dzhoof-mongodb mongorestore --uri=mongodb://127.0.0.1:27017/dzhoof-iptv \
  --gzip --archive < /var/backups/dzhoot/mongodb/<STAMP>/dzhoof-iptv.archive.gz

# 3) التراجع عن الصور — أعِد تسمية الصور العاملة القديمة
docker tag dzhoof-api:<OLD_TAG> ${DOCKER_IMAGE}
docker tag dzhoof-frontend:<OLD_TAG> ${DOCKER_FRONTEND_IMAGE}

# 4) أعد التشغيل من compose (نفس ملف الإنتاج)
docker compose -f docker-compose.production.yml --env-file /etc/dzhoot/.env.production up -d

# 5) تحقق
curl -s https://<DOMAIN>/health?details=true | head -c 400
docker compose -f docker-compose.production.yml ps
docker logs dzhoof-scheduler --tail 20
```

## قواعد النشر الآمن

- صورة جديدة دائمًا بوسم مميز (`v1.0.1-<sha>`) — لا تستخدم `latest` في الإنتاج.
- شغّل `scripts/deploy/preflight.sh` قبل النشر.
- جرّب على staging أولًا (انظر `STAGING_GUIDE.md`).
- راقب `/health?details=true` والسجلات لمدة 30 دقيقة بعد النشر.
- إذا ظهرت أخطاء: عُد للخطوة 3 فورًا.

## أوامر تشخيصية سريعة

```bash
docker compose -f docker-compose.production.yml ps
docker logs dzhoof-api --tail 100
docker logs dzhoof-scheduler --tail 100
docker exec dzhoof-mongodb mongosh dzhoof-iptv --quiet \
  --eval "db.scheduledtaskruns.find({},{taskName:1,status:1,error:1,startedAt:1}).sort({startedAt:-1}).limit(10).toArray()"
```
