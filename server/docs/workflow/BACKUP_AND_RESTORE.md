# Backup and restore drill

تستخدم المنصة `server/scripts/backup.sh` لإنشاء أرشيف MongoDB مضغوط بصلاحيات `0600` مع سياسة احتفاظ قابلة للضبط، وتستخدم `server/scripts/restore-drill.sh` لاختبار الاستعادة في قاعدة منفصلة.

## Cron للإنتاج

ضع الملف في `/etc/cron.d/dzhoof-backup` بعد تعديل المسارات والمالك:

```cron
# نسخ MongoDB يوميًا الساعة 02:15 UTC، مع سجل مستقل.
15 2 * * * dzhoof BACKUP_DIR=/var/backups/dzhoof/mongodb RETENTION_DAYS=14 MONGODB_URI='mongodb://mongodb:27017/dzhoof-iptv' /opt/dzhoot/server/scripts/backup.sh >> /var/log/dzhoof-backup.log 2>&1
```

لا تضع URI الحقيقي داخل ملف قابل للقراءة العامة. الأفضل تحميله من ملف أسرار بصلاحيات `0600` أو من systemd credentials، ثم استدعاء wrapper مملوك للمستخدم `dzhoof`.

## Restore drill شهري

يجب أن يكون هدف الاختبار MongoDB منفصلًا عن الإنتاج:

```bash
export ALLOW_RESTORE_DRILL=true
export BACKUP_FILE=/var/backups/dzhoof/mongodb/dzhoof-mongodb-YYYYMMDDTHHMMSSZ.archive.gz
export MONGODB_URI='mongodb://mongodb:27017/dzhoof-iptv'
export MONGODB_RESTORE_URI='mongodb://restore-mongodb:27017/dzhoof-restore-drill'
export RESTORE_DROP=true
server/scripts/restore-drill.sh
```

بعد نجاح الاستعادة، تحقق من عدد المستخدمين والقنوات والباقات والأكواد وسجلات التدقيق في قاعدة `dzhoof-restore-drill`. يجب تسجيل وقت الاستعادة، حجم النسخة، النتيجة، وأي فروقات في `server/docs/workflow/restore-drill-log.md`. يمنع السكربت الاستعادة إذا كان `MONGODB_RESTORE_URI` مساويًا لـ`MONGODB_URI`.

## سياسة الاحتفاظ

الافتراضي 14 يومًا. احتفظ بنسخة أسبوعية خارج المضيف، وشفّر النقل والتخزين، واختبر الاستعادة قبل أي تغيير مخطط في schema أو ترقية MongoDB.
