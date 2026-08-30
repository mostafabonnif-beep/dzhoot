# DZ HOOF — دليل نشر VPS

## الغرض ونطاق الدليل

يوثق هذا الدليل نشر منصة **DZ HOOF** القانونية للقنوات التلفزيونية المباشرة على خادم VPS جديد باستخدام Docker Compose. يفترض الدليل أن النطاق `ld-11.net` مملوك للمشغّل، وأن صور Docker الخاصة بالـBackend والواجهة قد بُنيت ودُفعت إلى سجل صور موثوق، أو أن هناك Release ثابتًا متاحًا للتنزيل. لا يضع هذا الدليل أي سر حقيقي داخل Git، ولا يوصي بفتح MongoDB أو Redis مباشرة على الإنترنت.

> **قاعدة تشغيلية:** لا تُفتح الخدمة للمستخدمين قبل نجاح `/health/live` و`/health/ready` و`/health?details=true` عبر HTTPS، وقبل التحقق من النسخ الاحتياطي واستعادة تجريبية في قاعدة غير إنتاجية.

## 1. مواصفات الخادم والتهيئة الأساسية

المواصفات الدنيا العملية لتشغيل API والواجهة وMongoDB وRedis وscheduler هي Ubuntu 22.04 LTS أو أحدث، و2 vCPU، و4 GB RAM، و50 GB SSD. يُفضّل استخدام 4 vCPU و8 GB RAM عند تفعيل فحوصات liveness الكثيفة أو استقبال عدد كبير من القنوات. يجب أن يكون الخادم في منطقة شبكة موثوقة، مع تفعيل تحديثات الأمان التلقائية أو جدول صيانة واضح.

| العنصر | المتطلب | ملاحظات تشغيلية |
| --- | --- | --- |
| نظام التشغيل | Ubuntu 22.04 LTS أو أحدث | لا تستخدم نظامًا منتهي الدعم |
| المعالج والذاكرة | 2 vCPU و4 GB RAM كحد أدنى | الزيادة مفيدة مع الفحص المتوازي للقنوات |
| التخزين | 50 GB SSD | راقب نمو MongoDB وسجلات Docker والنسخ |
| الشبكة | عنوان IPv4 ثابت، وIPv6 اختياري | سجّل العنوان في DNS |
| المنافذ العامة | TCP 80 و443 | Caddy يحتاج 80 للتوجيه وACME و443 لـHTTPS |
| المنافذ الإدارية | SSH من عنوان موثوق فقط | لا تفتح MongoDB أو Redis للعامة |

بعد إنشاء الخادم، أنشئ مستخدم تشغيل غير `root`، فعّل مفاتيح SSH، عطّل تسجيل الدخول بكلمة مرور إذا كان ذلك مناسبًا لسياسة الاستضافة، ثم فعّل جدارًا ناريًا بسيطًا. المثال التالي يفتح SSH وHTTP وHTTPS فقط؛ استبدل منفذ SSH إذا كان مختلفًا:

```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y ca-certificates curl git ufw unattended-upgrades
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo systemctl enable --now unattended-upgrades
```

## 2. ربط النطاق `ld-11.net` بـVPS

في Namecheap أو مزود DNS الحالي، أنشئ سجل `A` للاسم الجذر يشير إلى عنوان IPv4 الخاص بالخادم. أنشئ سجل `A` باسم `www` إذا كان المستخدمون سيصلون عبره، أو وجّه `www` إلى الجذر بواسطة CNAME. لا تضف سجل `AAAA` إلا إذا كان الخادم يملك IPv6 صالحًا ومفتوحًا ومختبرًا؛ سجل IPv6 غير الصحيح قد يجعل بعض الأجهزة تفشل قبل تجربة IPv4.

| الاسم | النوع | القيمة | TTL مقترح |
| --- | --- | --- | --- |
| `@` | `A` | عنوان IPv4 الخاص بالـVPS | 300 أثناء الإعداد، ثم 3600 |
| `www` | `CNAME` أو `A` | `ld-11.net` أو نفس IPv4 | 300 أثناء الإعداد |

تحقق من الانتشار قبل تشغيل HTTPS. يجب أن يعيد الأمر عنوان الخادم نفسه من أكثر من نقطة DNS، ويمكن أن يستغرق الانتشار عدة دقائق أو أكثر حسب TTL السابق:

```bash
dig +short A ld-11.net
getent ahostsv4 ld-11.net
```

## 3. تثبيت Docker وCompose

استخدم مستودع Docker الرسمي بدل حزم قديمة من مستودع Ubuntu. بعد تثبيت المحرك، أضف مستخدم النشر إلى مجموعة `docker` ثم أعد فتح جلسة SSH حتى تُطبّق العضوية. لا تمنح حسابات غير موثوقة صلاحية Docker، لأن هذه الصلاحية تعادل عمليًا صلاحية root على الخادم.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
printf '%s\n' \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
docker version
docker compose version
```

أنشئ مجلد نشر ثابتًا خارج مجلدات المستخدم المؤقتة، ثم انسخ ملفات Compose و`Caddyfile` والسكربتات المطلوبة إلى الخادم. يُفضّل أن يكون المصدر Release أو commit معروفًا، وليس `main` المتغير أثناء النشر:

```bash
sudo mkdir -p /opt/dzhoot /etc/dzhoot /var/backups/dzhoot/mongodb
sudo chown -R "$USER":"$USER" /opt/dzhoot /var/backups/dzhoot
cd /opt
git clone https://github.com/merci1994dz/dzhoot.git dzhoot
cd /opt/dzhoot/server
git checkout <RELEASE_TAG_OR_COMMIT>
```

## 4. إعداد البيئة والأسرار

انسخ نموذج البيئة إلى ملف خارج المستودع، ثم اجعل صلاحياته `0600`. لا تستخدم القيم التجريبية ولا تضع الملف الحقيقي في Git أو في سجل الأوامر. يجب أن تكون الأسرار طويلة ومستقلة؛ لا تعِد استخدام أسرار JWT أو playback أو TOTP بين البيئات.

```bash
sudo install -m 0600 /opt/dzhoot/server/.env.production.example /etc/dzhoot/.env.production
sudo chown "$USER":"$USER" /etc/dzhoot/.env.production
cp /etc/dzhoot/.env.production /tmp/dzhoof-env-edit
$EDITOR /etc/dzhoot/.env.production
rm -f /tmp/dzhoof-env-edit
```

إذا لم يوجد `.env.production.example` في الإصدار المختار، استخدم `.env.example` كمرجع فقط، ولا تنشئ ملف الإنتاج داخل المستودع. يجب ضبط القيم الأساسية التالية بما يطابق النطاق وسجل الصور وبيئة البريد. تُملأ بقية القيم من `server/.env.example` و`server/docs/RELEASE_RUNBOOK.md` حسب الميزات المفعّلة.

| المتغير | قيمة الإنتاج أو القاعدة |
| --- | --- |
| `DOMAIN` | `ld-11.net` |
| `ACME_EMAIL` | بريد إداري يستقبل تنبيهات شهادة TLS |
| `APP_URL` و`PUBLIC_BASE_URL` | `https://ld-11.net` |
| `ALLOWED_ORIGINS` | `https://ld-11.net`، مع إضافة `https://www.ld-11.net` فقط عند استخدامه |
| `DOCKER_IMAGE` | صورة Backend بإصدار أو digest ثابت |
| `DOCKER_FRONTEND_IMAGE` | صورة Frontend بإصدار أو digest ثابت |
| `JWT_ACCESS_SECRET` و`JWT_REFRESH_SECRET` | أسرار مستقلة بطول لا يقل عن 32 حرفًا |
| `XTREAM_SECRET_KEY` و`PLAYBACK_TOKEN_SECRET` و`TOTP_ENCRYPTION_KEY` | أسرار مستقلة مخصصة للإنتاج |
| `SUPER_ADMIN_USERNAME` و`SUPER_ADMIN_PASSWORD` و`SUPER_ADMIN_EMAIL` | بيانات حساب الإدارة الحقيقية، وليست placeholders |
| `SUBSCRIPTION_REQUIRED` | `true` قبل فتح الخدمة التجارية |
| `DISABLE_SCHEDULER` | `true` في API لأن خدمة scheduler تعمل في حاوية منفصلة |
| `TRUST_CF_CONNECTING_IP` | `true` فقط إذا كان المرور يمر فعلًا عبر Cloudflare |
| `MAIL_PROVIDER` و`BREVO_*` | قيم مزود البريد المعتمد، أو إعداد تطويري مغلق قبل الإطلاق |
| `FCM_*` و`GOOGLE_*` و`GH_*` و`SENTRY_*` | تُضبط فقط عند تفعيل التكامل وبواسطة مدير أسرار |

ولّد الأسرار من جلسة آمنة، ثم ألصقها في مدير الأسرار أو ملف البيئة المحمي بدل وضعها في shell history:

```bash
openssl rand -hex 32  # JWT_ACCESS_SECRET
openssl rand -hex 32  # JWT_REFRESH_SECRET
openssl rand -hex 32  # XTREAM_SECRET_KEY
openssl rand -hex 32  # PLAYBACK_TOKEN_SECRET
openssl rand -hex 32  # TOTP_ENCRYPTION_KEY
```

تحقق من تكوين Compose دون طباعة ملف البيئة في الطرفية. إذا فشل التحقق، أصلح المتغيرات قبل تشغيل أي حاوية:

```bash
cd /opt/dzhoot/server
docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml config >/tmp/dzhoof-compose.rendered.yml
chmod 600 /tmp/dzhoof-compose.rendered.yml
```

يستخدم Compose شبكة Docker خارجية باسم `dzhoof-shared-network` لأن بعض الخدمات متصلة بشبكة مشتركة. أنشئها مرة واحدة فقط إذا لم تكن موجودة، ثم راجع أن اسمها لا يتعارض مع Stack آخر:

```bash
docker network inspect dzhoof-shared-network >/dev/null 2>&1 || \
  docker network create dzhoof-shared-network
```

## 5. تشغيل الخدمات وتحديثها

يستخدم الإصدار الإنتاجي في المستودع Caddy أمام API والواجهة، مع MongoDB وRedis وscheduler. لا تُشغّل `docker compose up` من دون `--env-file` الصحيح، ولا تستخدم `latest` لأن التراجع يتطلب image digest معروفًا.

```bash
cd /opt/dzhoot/server
docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml pull

docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml up -d

docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml ps
```

افحص سجلات API وCaddy وscheduler، ثم انتظر اتصال MongoDB وبدء الخدمات قبل تنفيذ اختبارات الصحة. لا تشارك السجلات العامة إذا احتوت على بيانات اعتماد أو روابط بث مصدرية؛ راجع إعدادات redaction قبل إرسالها إلى طرف آخر.

```bash
docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml logs --tail=200 api caddy scheduler
```

## 6. HTTPS: Caddy المدمج أو Nginx/Certbot الخارجي

الطريقة الموصى بها لهذا المستودع هي **Caddy المدمج**. يقرأ Caddy `DOMAIN` و`ACME_EMAIL` من البيئة، يطلب شهادة Let’s Encrypt تلقائيًا، ويجددها تلقائيًا، لذلك لا حاجة إلى تشغيل Certbot يدويًا عندما تكون خدمة `caddy` هي نقطة الدخول الوحيدة على المنفذين 80 و443. يجب أن تكون سجلات DNS قد وصلت إلى الخادم وأن يسمح الجدار الناري بالمنفذين.

```bash
curl --fail --silent --show-error https://ld-11.net/health/live
curl --fail --silent --show-error https://ld-11.net/health/ready
curl --fail --silent --show-error 'https://ld-11.net/health?details=true'
```

إذا كانت سياسة البنية التحتية تفرض **Nginx وCertbot** بدل Caddy، فلا تشغّل خدمتي TLS معًا على نفس المنفذين. في هذه الحالة يجب إيقاف أو تعديل خدمة Caddy، ونشر API والواجهة على شبكة داخلية أو منافذ loopback فقط، ثم جعل Nginx يمرر `https://ld-11.net/api/*` و`/health*` إلى API ويمرر بقية المسارات إلى Frontend. يُشغّل Certbot على المضيف مع تجديد تلقائي، وتُختبر إعادة تحميل Nginx بعد كل تجديد. لا تُعدّل هذا المسار إلا بعد اعتماد ملف Compose خاص بـNginx؛ `docker-compose.production.yml` الحالي مصمم لـCaddy.

## 7. فحوص ما بعد النشر

يُعد API جاهزًا عندما يعيد `/health/live` حالة `ok` مع `uptime`، ويعيد `/health/ready` حالة `ok` و`mongodb: connected`. Redis اختياري للتشغيل الأساسي لكنه يجب أن يظهر `connected` في البيئة الإنتاجية إذا كانت الميزات التي تعتمد عليه مفعّلة. يتحقق `/health?details=true` من بنية المصادر وEPG وscheduler دون إظهار أسرار الاتصال.

| الفحص | النتيجة المتوقعة |
| --- | --- |
| `GET https://ld-11.net/health/live` | HTTP 200، و`status: ok`، و`uptime` رقمي |
| `GET https://ld-11.net/health/ready` | HTTP 200، و`status: ok`، و`mongodb: connected` |
| `GET https://ld-11.net/health` | HTTP 200، و`version` و`release.commit` و`release.builtAt` من دون تفاصيل قواعد البيانات |
| `GET https://ld-11.net/health?details=true` | HTTP 200 وبنية `sources` و`epg` و`scheduler` و`alerting` |
| الصفحة الرئيسية | تحميل Frontend عبر HTTPS دون mixed content |
| تسجيل الدخول والتفعيل | نجاح المسار التجاري بحساب اختبار فقط |
| Live TV | تشغيل قناة مصرّح بها، وظهور EPG أو حالة عدم توفره بوضوح |

نفذ بعد ذلك Smoke تجاريًا محدودًا: تسجيل دخول بحساب اختبار، فتح قائمة القنوات، تشغيل قناة قانونية، اختبار التبديل أو fallback، فتح لوحة الإدارة، اختبار استيراد M3U مصرح به، وفحص إشعارات الخطأ. لا تستخدم حساب super-admin أو مصادر غير مصرح بها في اختبار عام.

### التحقق من هوية الإصدار

## 6ب. تجاوز compose الإنتاج (Operator compose override)

الإنتاج يعمل بنسخة compose معدّلة محلياً (تفعيل auth لـ Mongo/Redis عبر `mongod --auth` و`--requirepass`، وربط شبكة `gkz-network` المشتركة) غير الموجودة في المستودع — وهي حالة مقصودة: المستودع هو الخط الأساسي، والإنتاج له تجاوزاته.

عند النشر عبر `atomic-deploy.sh`:
- إذا وُجد ملف `/etc/dzhoot/docker-compose.production.yml` (مثبّت بصلاحيات 600) يُنسخ تلقائياً فوق compose الإصدار قبل `compose up`.
- **لا تحذف هذا الملف**: نسخة التاربال (بلا auth) على Mongo مفعّل auth تجعل API في حلقة إعادة تشغيل (`find requires authentication`) — حصل ذلك 2026-08-30 وأُصلح بهذه الآلية.
- لتحديث التجاوز: عدّل الملف في `/etc/dzhoot/` ثم أعد النشر (أو انسخ من `/opt/dzhoot/server/docker-compose.production.yml`).

عند النشر عبر `stage-release.sh` ثم `atomic-deploy.sh`، يمرر النشر SHA الذي تحقق منه إلى `RELEASE_COMMIT` ووقت البناء إلى `RELEASE_BUILT_AT`. يجب أن يطابق commit الظاهر في health قيمة الإصدار المستهدف، وأن تحمل صور API وfrontend labels OCI نفسها. هذه القيم لا تعد أسراراً، وهي ضرورية للتحقيق والتراجع.

```bash
curl --fail --silent https://ld-11.net/health
# تأكد من release.commit = SHA المستهدف وrelease.builtAt = وقت البناء

docker image inspect dzhoof-api:current \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
tail -n 1 /var/log/dzhoof-deploys.log
```

إذا لم تتطابق قيمة `release.commit` مع SHA المستهدف، أوقف الإطلاق وطبّق rollback عبر الإصدار السابق؛ لا تفترض أن وسم `:current` يحدد المصدر وحده.

## 8. النسخ الاحتياطي وسياسة الاستعادة

يوفر المشروع `server/scripts/backup.sh` لإنشاء archive مضغوط من MongoDB بصلاحيات `0600`، والتحقق من gzip، والنقل الذري، وحذف الملفات المحلية الأقدم من `RETENTION_DAYS`. النسخة المحلية وحدها ليست خطة تعافٍ؛ يجب نسخ الناتج إلى تخزين منفصل ومشفّر مع checksum وversioning وMFA أو قفل حذف عند توفره.

أنشئ ملفًا محميًا خارج المستودع. يجب أن يكون عنوان MongoDB قابلًا للوصول من مكان تشغيل `mongodump`; إذا شُغّلت الأداة من حاوية أدوات على شبكة `dzhoof-network` فاستخدم اسم الخدمة `mongodb`، ولا تفتح منفذ MongoDB للعامة:

```bash
sudo install -m 0600 /dev/null /etc/dzhoot/backup.env
sudoedit /etc/dzhoot/backup.env
```

محتوى نموذجي للملف:

```dotenv
MONGODB_URI=mongodb://mongodb:27017/dzhoof-iptv
BACKUP_DIR=/var/backups/dzhoot/mongodb
RETENTION_DAYS=14
ALERT_WEBHOOK_URL=
```

جدول النسخ اليومي عند 03:15، مع حفظ السجل في ملف لا يضم URI أو الأسرار:

```cron
15 3 * * * . /etc/dzhoot/backup.env && /opt/dzhoot/server/scripts/backup.sh >> /var/log/dzhoot-backup.log 2>&1
```

اختبر كل نسخة بواسطة `gzip -t`، وانقلها إلى موقع منفصل. نفذ restore drill دوريًا في قاعدة اختبار منفصلة باستخدام `server/scripts/restore-drill.sh` و`ALLOW_RESTORE_DRILL=true`. يرفض السكربت الاستعادة إذا كان URI الاختبار مطابقًا لـURI الإنتاج، ويجب ألا تستخدم `RESTORE_DROP=true` إلا على قاعدة اختبار قابلة لإعادة البناء. التفاصيل الكاملة موجودة في [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md).

| هدف تشغيلي ابتدائي | قيمة مقترحة يجب اعتمادها وتسجيلها |
| --- | --- |
| RPO | 24 ساعة كحد أقصى قبل تفعيل نسخ أكثر تكرارًا |
| RTO | يحدد بعد تجربة restore drill على نفس حجم البيانات |
| الاحتفاظ المحلي | 14 يومًا وفق `RETENTION_DAYS` |
| الاحتفاظ خارج الخادم | يومي قصير الأجل وأسبوعي أطول أجلًا، حسب تكلفة التخزين |
| اختبار الاستعادة | مرة قبل الإطلاق ثم دوريًا، مع سجل نتيجة ومدة |

## 9. التحديث والتراجع

قبل أي تحديث، احفظ image digest الحالي ونسخة من ملف البيئة، وتأكد من وجود نسخة MongoDB حديثة خارج الخادم. نفذ `docker compose config`، ثم اسحب الصور بالإصدار المحدد وشغّل `up -d`. بعد التحديث، راقب health checks والسجلات وSmoke المختصر قبل إعلان الإصدار.

```bash
cd /opt/dzhoot/server
cp /etc/dzhoot/.env.production /etc/dzhoot/.env.production.$(date -u +%Y%m%dT%H%M%SZ)
docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml pull
docker compose --env-file /etc/dzhoot/.env.production \
  -f docker-compose.production.yml up -d
```

عند عطل حرج، أوقف الحركة الجديدة، أعد `DOCKER_IMAGE` و`DOCKER_FRONTEND_IMAGE` إلى الإصدار السابق، شغّل Compose مجددًا، ثم تحقق من `/health/ready` وسجل الدخول والتشغيل. لا تحذف MongoDB volume ولا تستخدم `--drop` أثناء rollback؛ الاستعادة من نسخة احتياطية مسار منفصل يحتاج موافقة موثقة وخطة رجوع.

## 10. إدارة الحوادث وقائمة قبول الإطلاق

لا يُقبل الإطلاق النهائي إلا بعد أن تكون DNS وHTTPS وhealth checks ونسخة خارجية وrestore drill وSmoke التجاري موثقة. يجب حفظ رقم الإصدار، وcommit أو image digest، ووقت النشر، ونتيجة الفحوص، وRTO/RPO، واسم الشخص الذي وافق على فتح الخدمة.

| بند القبول | الحالة عند الإطلاق |
| --- | --- |
| DNS `ld-11.net` يشير إلى VPS | ☐ |
| المنافذ 80 و443 فقط عامة، وSSH مقيّد | ☐ |
| أسرار الإنتاج خارج Git وبصلاحية `0600` | ☐ |
| `docker compose ... config` ناجح | ☐ |
| Caddy حصل على شهادة HTTPS | ☐ |
| `/health/live` و`/health/ready` و`/health?details=true` ناجحة | ☐ |
| MongoDB وRedis volumes مستمران بعد إعادة تشغيل الحاويات | ☐ |
| نسخة MongoDB خارج الخادم وchecksum محفوظ | ☐ |
| restore drill منفصل ناجح | ☐ |
| Smoke لتسجيل الدخول وLive TV والتفعيل ناجح | ☐ |
| خطة rollback وimage digest السابق محفوظان | ☐ |

> **مرجعان إلزاميان قبل النشر:** [`RELEASE_RUNBOOK.md`](./RELEASE_RUNBOOK.md) و[`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md). هذا الدليل يضيف تفاصيل VPS وDNS وDocker، ولا يلغي ضوابط الأمان والنسخ والاستعادة الموجودة فيهما.
