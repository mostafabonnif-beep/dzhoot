# DZ HOOF — Staging Guide (audit-remediation-v1)

الهدف: بيئة اختبار معزولة تكرر الإنتاج قبل أي نشر على الخادم الحي، مع بقاء
قاعدة البيانات منفصلة تمامًا.

## لماذا staging؟

- تغييرات هذا الفرع (EPG scheduler، قفل التسجيل، Caddy headers، /health) لها
  آثار سلوكية لا تظهر في الوحدات/الاختبارات وحدها.
- أي انقطاع في الإنتاج ممنوع — staging هو المكان الوحيد لتجربة التراجع والنشر.

## الخيار الموصى به: خادم VPS صغير ثانٍ (نفس الأبعاد تقريبًا)

```bash
# على خادم staging (Ubuntu 24.04، Docker + compose plugin)
git clone <repo-url>
cd dzhoot/server
cp /etc/dzhoot/.env.production .env.staging   # ثم عدّل:
#   DOMAIN=staging.yourdomain.com
#   PUBLIC_BASE_URL=https://staging.yourdomain.com
#   ALLOWED_ORIGINS=https://staging.yourdomain.com
#   NODE_ENV=production
chmod 600 .env.staging
docker compose -f docker-compose.production.yml --env-file .env.staging up -d --build
```

> لا تنشر بيانات إنتاجية ضخمة على staging أثناء الفحص — استخدم مصدر M3U صغير
> مصرحًا به (مثل قائمة iptv-org لدولة واحدة) ومجموعة قنوات محدودة.

## خطة التحقق على staging (قائمة فحص)

### 1. استقرار الـ Scheduler (الإصلاح الرئيسي)
```bash
docker logs dzhoof-scheduler -f
# توقع: EPG refresh يبدأ، مصادر تفشل كلٌّ على حدة ولا توقف الباقي،
# لا FATAL ERROR/JavaScript heap out of memory، وheap مستقر.
docker exec dzhoof-mongodb mongosh dzhoof-iptv --quiet \
  --eval "db.scheduledtaskruns.find({taskName:'epg-refresh'},{status:1,error:1,durationMs:1}).sort({startedAt:-1}).limit(5).toArray()"
```

### 2. قفل التسجيل
```bash
curl -s -X POST https://staging.yourdomain.com/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"probe","email":"probe@example.com","password":"Probe12345!"}'
# توقع: HTTP 403 "Registration is currently disabled..."
# صفحة /register تعرض رسالة "التسجيل غير متاح حالياً" بدون نموذج.
# صفحة /login لا تعرض أزرار Google/GitHub ولا رابط "إنشاء حساب".
```

### 3. /health
```bash
curl -s https://staging.yourdomain.com/health            # status/version/requestId فقط
curl -s "https://staging.yourdomain.com/health?details=true"  # التفاصيل الكاملة
```

### 4. Caddy headers
```bash
curl -sI https://staging.yourdomain.com/ | grep -iE "content-security|permissions-policy|x-frame"
```

### 5. النسخ الاحتياطي
```bash
sudo /usr/local/sbin/dzhoof-mongo-backup
./scripts/backup/verify-backup.sh /var/backups/dzhoot/mongodb/<STAMP>/dzhoof-iptv.archive.gz
```

### 6. الأمان
```bash
./scripts/deploy/preflight.sh  # بعد تعبئة ENV_FILE
```

## ماذا لو تعذر بيئة staging الآن؟

- جرّب `docker compose -f docker-compose.selfhost.yml up -d` على جهاز محلي
  (المشروع يدعمها) مع قاعدة بيانات فارغة ومصدر صغير.
- الاختبارات الآلية (`npm test`) تغطي العزل والحدود، لكنها لا تحل محل staging
  لفحص الذاكرة الفعلية وسلوك الشبكة.

## قرار النشر للإنتاج

لا تنشر للإنتاج قبل:
1. staging أخضر (جميع البنود أعلاه).
2. موافقة صريحة من المالك على خطة النشر (لمسات Docker، ترقيات compose).
3. نسخة احتياطية حديثة موثقة (`verify-backup.sh` OK).
