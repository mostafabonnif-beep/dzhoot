# تقرير التسليم النهائي — DZ HOOF IPTV (جلسة 2026-08-25، الجولتان 15 و16)

> **اقرأ هذا أولًا.** الوثيقة الوحيدة التي تحتاجها لبدء العمل. تغطي: الوصول،
> كل ما أُنجز في هذه الجلسة (تصحيح المحاسبة + تحصين اللوحة + البث المباشر +
> التراجع التلقائي + APK رسمي + تنظيف القرص)، الحالة الحالية المُتحقق منها،
> ما تبقى بالأولوية، الأوامر السريعة، والمزالق.
> التفاصيل: `ADMIN_IMPROVEMENT_REPORT_ROUND15_AR.md` + سجل git (9e2ad9c).

---

## 1. الملخص التنفيذي

| الجبهة | النتيجة |
|---|---|
| **المستودع** | ✅ `main` = `9e2ad9c` — نظيف ومتطابق مع الخادم (12/12 ملفات sha256) |
| **الإنتاج** | ✅ `v1.0.1-20260825T074000Z` — 6 حاويات healthy + لا OOM |
| **الإيراد الصحيح** | ✅ «إيراد هذا الشهر 13.700 DZD» (كان 0 — مشتريات المحلات 4.700+9.000) |
| **البث المباشر** | ✅ مفعّل — الفيديو يخرج من Upstream مباشرة (خادمك حر) |
| **التراجع التلقائي** | ✅ مباشر→بروكسي (خادم + تطبيق) — منشور ومُختبَر حيًا |
| **APK رسمي موقّع** | ✅ `dzhoof-release-1.0.2-dzhoof` (official/release) |
| **القرص** | ✅ 81% ← 57% (~18GB حُررت) |
| **الاختبارات** | ✅ باك-إند 272/272 + واجهة 6/6 + tsc + eslint 0 + CI أخضر |

---

## 2. الوصول (ثابت)

- **SSH**: `dzhoof-admin@5.135.79.221` بمفتاح ed25519 —
  **`/home/user/.workspace/dzhoot/dzhoof-admin-key`** (chmod 600). sudo بلا كلمة مرور.
  ⚠️ كلمة مرور root معطّلة server-side (publickey فقط).
- **GitHub**: `mostafabonnif-beep/dzhoot` — PAT على الخادم `/etc/dzhoot/github.token`
  (يملك **actions:read + workflow** — يستخدم لسحب artifacts وتشغيل release).
- **الإنتاج**: `/opt/dzhoot/server` (نسخة ملفات — **ليست git checkout**) + الأسرار
  `/etc/dzhoot/.env.production` (chmod 600) + `/etc/dzhoot/github.token`.
- **لوحة الأدمن**: `https://iptv.ld-11.net/admin` — `admin` / (كلمة المرور القديمة
  مكشوفة في المحادثة — **يجب تغييرها من اللوحة: الإعدادات ← تغيير كلمة المرور**).
- **بوابة الموزع**: `https://iptv.ld-11.net/reseller/login` (لكل محل يوزر/باسورد).
- **قاعدة البيانات**: حاوية `dzhoof-mongodb` — القاعدة **`dzhoof-iptv`** دائمًا
  (mongosh داخل الحاوية يتصل `test` افتراضيًا — حدد القاعدة دائمًا).

---

## 3. ما أُنجز في هذه الجلسة

### الجولة 15 — تصحيح المحاسبة + تحصين اللوحة (منشور v1.0.1-20260825T065344Z)
1. **الإيراد الصحيح**: = مشتريات رصيد المحلات (GRANT موجب) + تسليمات الدفعات
   (wholesale) + تفعيلات أكواد المشغّل فقط (بدون عدّ مزدوج/تضخيم من الخصومات).
2. **إصلاح `netQty`** في بوابة الموزع — كان `null` بسبب `-'$quantity'` غير الصالح
   في aggregation (استبدل بـ `$subtract: [0, '$quantity']`) + الاسترجاع كان يُطرح
   بدل أن يُضاف.
3. **تغيير كلمة مرور الأدمن من اللوحة** (كان مفقودًا) + إخفاء كلمة SMTP +
   SSRF للقنوات + إفلات regex + 400 للمكرر + تأكيد تعطيل المستخدم + توجيه 401
   للموزع + حارس دور البوابة + حفظ `maxConcurrentStreams`.
4. إصلاح كسر CI قديم (parseDebtAmount مكرر في admin-reseller-debts.js).

### الجولة 16 — «القنوات تقعد شغالة للجميع» (منشور v1.0.1-20260825T074000Z)
5. **البث المباشر مفعّل**: `ALLOW_DIRECT_PLAYBACK=true` (في .env **و** بلوك
   environment في compose — compose كان لا يمرر المتغير!) + `directPlayback:true`
   على مصدر Primary Upstream. الضغط كله على Upstream (خلف Cloudflare)؛ الخادم
   للتوكين/API فقط → آلاف المستخدمين ممكنين.
6. **التراجع التلقائي مباشر→بروكسي**: tv.js يرجع `proxyPlaybackUrl` (توكن بروكسي
   بنفس sessionId — لا عدّ مزدوج) للمصادر direct؛ التطبيق يمرره لـ
   ErrorRecoveryManager الموجودة (3 مباشرة ← بروكسي ← بدائل). تحقق حي:
   مباشر 302→Upstream، بروكسي 200 قائمة عبر الخادم.
7. **APK رسمي موقّع**: dispatch لـ release-candidate.yml عبر PAT الخادم →
   `dzhoof-release-1.0.2-dzhoof` (official/release/app-official-release.apk).
   **توزيعه على الزبائن = تفعيل الاحتياط عندهم** (التطبيق القديم يشتغل لكن بلا احتياط).
8. **تنظيف القرص**: 81%←57% (صور docker قديمة + build cache 10.8GB + نسخ
   احتياطية 74→12 + /tmp وgradle ~6GB).

---

## 4. الحالة الحالية (مُتحققة 2026-08-25)

- 16,640 قناة | 7 مستخدمين | 6 اشتراكات | 3 محلات | ~67K VOD/Series.
- `deliveryMode: direct` لـ LIVE وMOVIE (تحقق عبر /streams/authorize).
- `proxyPlaybackUrl` حي في /tv/playback-token.
- القرص: 44G مستخدم / 34G متاح (57%).
- الإنتاج متطابق مع main 9e2ad9c (12 ملفات sha256 — القائمة في القسم 6).

---

## 5. ما تبقى (بالأولوية)

### 🔴 أمني (مطلوب من المستخدم — كلمتا المرور مكشوفتان في المحادثة)
- [ ] تغيير كلمة مرور **admin** (الإعدادات ← تغيير كلمة المرور) — القسم موجود.
- [ ] تغيير كلمة مرور **root** عند المزود (OVH) + مراجعة صلاحيات github.token.

### 🔴 تجاري (يحدد سعة الزبائن)
- [ ] **رقم Max Connections من لوحة Upstream** — السقف الحقيقي للبث المباشر
      (الزبون الواحد = حتى اتصالين). نبيع الاشتراكات على أساسه.
- [ ] بوابة دفع (CinetPay/Paymee/Stripe) — أكبر عائد.
- [ ] مراجعة الأسعار (شهري 500 / 6أشهر 2500 / سنوي 4500 دج).

### 🔴 تفعيل الإشعارات والبريد (الواجهة جاهزة)
- [ ] Webhook Discord/Slack + مفاتيح Brevo SMTP + مفاتيح FCM
      (قسم «التنبيهات والإشعارات» في الإعدادات؛ كلمة SMTP تُحفظ دون عرض).

### 🟡 جودة الكتالوج
- [ ] تنظيف القنوات الميتة (~7-10%) + أسماء متسخة + مصدر عربي/جزائري ثانٍ.
- [ ] EPG عربي + beIN SPORTS 5/MAX.

### 🟢 تشغيلي
- [ ] نسخ احتياطي خارجي (restic) + اختبار استعادة.
- [ ] تنبيه أوتوماتيكي إذا Upstream وقع (webhook — ينتظر عنوانًا من المستخدم).

---

## 6. الأوامر السريعة

```bash
# SSH
ssh -i ~/.workspace/dzhoot/dzhoof-admin-key dzhoof-admin@5.135.79.221

# الصحة
curl -s https://iptv.ld-11.net/health/ready
curl -s 'https://iptv.ld-11.net/health?details=true' | head -c 400

# النشر (بعد مزامنة الملفات tar+scp إلى /opt/dzhoot/server)
cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply   # ~10 دقائق

# مزامنة الملفات: tar من الريبو المحلي → scp → sudo tar -xzf -C /opt/dzhoot
# تحقق: sha256sum (12 ملفات مفتاحية — القائمة في آخر هذا القسم)

# GitHub push (من الخادم)
TOKEN=$(sudo cat /etc/dzhoot/github.token)
git push https://x-access-token:$TOKEN@github.com/mostafabonnif-beep/dzhoot.git main

# سحب APK رسمي من آخر release run (الخادم)
RID=<run_id>; curl -sL -H "Authorization: Bearer $(sudo cat /etc/dzhoot/github.token)" \
  "https://api.github.com/repos/mostafabonnif-beep/dzhoot/actions/runs/$RID/artifacts" | jq -r '.artifacts[0].archive_download_url'

# تشغيل release (PAT يملك workflow scope):
curl -s -X POST -H "Authorization: Bearer $(sudo cat /etc/dzhoot/github.token)" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/mostafabonnif-beep/dzhoot/actions/workflows/release-candidate.yml/dispatches" \
  -d '{"ref":"main","inputs":{"version_name":"X.Y.Z","api_url":"https://iptv.ld-11.net"}}'

# Mongo (حدد القاعدة دائمًا!)
sudo docker exec dzhoof-mongodb mongosh dzhoof-iptv

# ملفات المقارنة (12): tv.js, admin.js, reseller.js, fcm-service.ts, task-registry.ts,
# admin-notifications.js, models/CodeBatch.ts, docker-compose.production.yml,
# frontend .../admin/settings/page.tsx, .../admin/page.tsx, __tests__/round15-accounting.test.ts,
# __tests__/tv-playback-proxy-fallback.test.ts
```

---

## 7. دروس ومزالق (هذه الجلسة — مهمة)

1. **compose لا يمرر المتغيرات إلا المدرجة في بلوك `environment:`** — إضافة متغير
   لـ .env وحده لا يكفي؛ أضِف السطر في compose ثم `up -d` (رأيناها مع
   ALLOW_DIRECT_PLAYBACK: الحاوية لم تأخذه حتى أُضيف للبلوك).
2. **روابط Upstream**: المدخل المستقر `cf.upstream-host-redacted/live/<t>/<t>/<id>.m3u8`
   يعيد **302 دائمًا** إلى رابط موقّع جديد (نطاق عشوائي:80 + توكن base64) — يصلح
   للبث المباشر، والتوكن يتجدد عند كل طلب. التطبيق يسمح cleartext HTTP.
3. **التطبيق القديم بلا احتياط**: التراجع direct→proxy يعمل فقط مع التطبيق الجديد
   (1.0.2+)؛ الخادم متوافق مع القديم (يتجاهل proxyPlaybackUrl).
4. **`-$quantity` في MongoDB aggregation = null صامت** — استخدم
   `{ $subtract: [0, '$quantity'] }` (وجدناه مكسورًا في الإنتاج).
5. **PAT الخادم يملك workflow scope** — dispatch للـ release يشتغل منه مباشرة
   (الكونكتور بلا actions:write).
6. **النشر ~10 دقائق** (إعادة بناء api+frontend)؛ نسخة احتياطية تلقائية قبل النشر
   في `/var/backups/dzhoot/mongodb/` (نحتفظ بأحدث 12).
7. **القرص**: نظّفنا لكن راقب — صور docker القديمة تتراكم مع كل نشر
   (`docker image prune -a -f --filter "until=72h"` + `docker builder prune -f`).
8. **مجلد النشر المحلي**: `/home/user/.workspace/dzhoot-deploy/` — يحتوي
   `dzhoot-round16.tar.gz` (حزمة النشر)، وAPK الرسمي/الستيجنغ (zip — النشر المباشر
   للملفات >~30MB يفشل في publish_file، استخدم zip).
9. **البث المباشر قابل للتراجع**: اقلب `ALLOW_DIRECT_PLAYBACK` أو `directPlayback`
   على المصدر ليعود كل شيء بروكسيًا.

---

## 8. الحالة النهائية

- GitHub `main` = `9e2ad9c` = الخادم (12/12 sha256) — كل التغييرات مدفوعة.
- الإنتاج `v1.0.1-20260825T074000Z` سليم: بث مباشر + تراجع تلقائي + إيراد صحيح.
- APK الرسمي `1.0.2-dzhoof` جاهز للتوزيع (موقّع، يشمل الاحتياط).
- أوراق الاعتماد (المفتاح، PAT، روابط اللوحات) في القسم 2.
- الخطوة الأولى للي بعدي: تذكير المستخدم بتغيير كلمتي المرور (admin + root)
  وطلب رقم Max Connections من لوحة Upstream.
