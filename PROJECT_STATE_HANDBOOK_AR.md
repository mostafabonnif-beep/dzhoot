# دليل حالة مشروع DZ HOOF — المرجع الموحد

> آخر تحديث: **2026-08-23** — بعد نشر إصلاح حالة القنوات والتحقق منه.
>
> **اقرأ هذه الوثيقة أولًا قبل أي عمل.** هدفها: عدم إعادة فحص المشروع كاملًا في كل جلسة. أي تغيير جوهري في البنية أو البيانات أو النشر يجب أن يُسجَّل هنا في نفس اليوم.

---

## 1. ما هو المشروع

منصة **DZ HOOF IPTV**: تطبيق Android TV + خادم إدارة (API) + لوحة تحكم إدارية (Web). إدارة قنوات مباشرة، VOD، مسلسلات، EPG، مستخدمين، أجهزة، باقات اشتراك، وأكواد تفعيل.

- **المستودع**: https://github.com/mostafabonnif-beep/dzhoot (عام)
- **الإنتاج**: https://iptv.ld-11.net (لوحة الإدارة `/admin`)
- **المالك**: merci1994dz / mostafabonnif-beep (يتواصل بالعربية، لهجة جزائرية)

## 2. البنية التقنية

| المكوّن | التقنية |
|---|---|
| Backend | Node.js + Express + TypeScript — `/server/backend` |
| قاعدة البيانات | MongoDB 7 (مجلد `dzhoof-iptv`) |
| كاش/قوائم انتظار | Redis 7 (appendonly) |
| لوحة التحكم | Next.js 16 + React 18 + Tailwind — `/server/frontend` (RTL، عربي/إنجليزي/فرنسي) |
| حزمة مشتركة | `/server/packages/shared` (أنواع + منطق مشترك) |
| تطبيق أندرويد | Jetpack Compose (TV) + Media3/ExoPlayer + Hilt + Room — `/android` |
| خادم الويب | Caddy 2.8.4 (HTTPS Let's Encrypt + ترويسات أمان) |
| الاختبارات | Jest (221 اختبار backend) + Playwright e2e + GitHub Actions CI |
| النشر | Docker Compose على VPS — بناء محلي لصور `dzhoof-api:current` / `dzhoof-frontend:current` |

## 3. بيئة الإنتاج (VPS)

- **الخادم**: 5.135.79.221 — `vserver-client41.dzsecurity.net` — Ubuntu 24.04 LTS — 5.8GB RAM / 77GB قرص (53% مستخدم)
- **SSH**: مستخدم `dzhoof-admin` بمفتاح ED25519 فقط (رفض كلمة المرور عبر SSH). `fail2ban`: ~4 محاولات فاشلة/10 دقائق → حظر (المدة أطول من ساعة). فك الحظر: `sudo fail2ban-client set sshd unbanip <IP>`
- **الحاويات** (6): `dzhoof-api` (3000، حد ذاكرة 2048m)، `dzhoof-scheduler` (2048m)، `dzhoof-frontend` (3000)، `dzhoof-mongodb` (27017)، `dzhoof-redis` (6379)، `dzhoof-caddy` (80/443)
- **الشبكات**: `dzhoof-network` (داخلية) + **`dzhoof-shared-network` خارجية مشتركة مع حاويات مستأجرين آخرين** (api/frontend مرتبطان بها — ملاحظة أمنية معروفة، لم تُعالج بعد؛ Redis/Mongo بلا كلمات مرور لكن غير مكشوفة للعامة)
- **الأسرار**: `/etc/dzhoot/.env.production` (perm 600) — لا شيء منها في Git. يوجد أيضًا `/etc/dzhoot/github.token` (صلاحيات كاملة للمستودع) و`android-signing/` (مفاتيح التوقيع)
- **النسخ الاحتياطي**: mongodump يومي 03:15 UTC + restic مشفّر محلي (استبقاء 7أ/4أ/6ش) + `dzhoof-healthcheck.timer`. **النسخ البعيد غير مفعّل بعد**
- **الوصول من الصندوق**: مفتاح SSH + سكربت `ssh_vps.py` + نسخة github.token في مساحة العمل المحلية (perm 600)

## 4. مصادر المحتوى (الوضع الفعلي 2026-08-23)

| المصدر | النوع | القنوات | الحالة |
|---|---|---|---|
| **Primary Upstream** (`cf.upstream-host-redacted`) | Xtream | 16,632 | Active — **directPlayback=true**، VOD 66,866، مسلسلات 16,804 |
| **iptv-org Algeria (free legal)** | M3U | 7 | Active — يزامن بنجاح بعد إصلاح مفاتيح scheduler |

- **مهم — تشغيل Upstream المباشر**: Upstream يحظر IP مراكز البيانات (يرد **HTTP 456** على `/live/...m3u8` من الخادم). القنوات تُبث مباشرة من شبكة المستخدم. للعمليات الخادمية (المزامنة، الـ proxy) يوجد **Relay منزلي**: redsocks + نفق SSH عكسي (المنفذ 9000) يمر عبر IP منزل المالك — التوثيق الكامل: `server/docs/ops/UPSTREAM_RELAY_OPS.md`. التوجيه يعمل فقط عندما يكون النفق المنزلي مفتوحًا.
- **حالة القنوات**: 16,639 قناة → **16,638 healthy / 1 failing** (قناة M3U ميتة فعلًا). التطبيق لا يخفي قنوات directPlayback عن المستخدمين.
- **EPG**: تغطية **~9% فقط** (15,220 قناة بلا دليل) + **13/50 مصدر EPG فاشل** (iptv-epg.org يرد 404) — أهم مشكلة متبقية في اللوحة.

## 5. الوصول للوحة والبيانات

- اللوحة: https://iptv.ld-11.net/admin (بيانات الدخول لدى المالك/في سجل الصندوق — لا تُنشر هنا)
- API: `/api/v1` — مصادقة عبر `x-session-id` أو `Bearer` (JWT)
- مستخدمو اللوحة: 2 أدمن (admin، merci1994) + 3 عملاء اختبار (`client_*@clients.dzhoof.invalid`)
- الأجهزة المقترنة: 4 (كلها samsung SM-S906B للمالك) — إصدار التطبيق الحالي: **1.0.8** (versionCode 10008)
- الباقات: باقة واحدة فقط "اختبار داخلي — Android TV" (DZD 0) — **لا بوابة دفع بعد**
- أكواد التفعيل: 102 (51 غير مستخدم، 47 ملغى، 4 مفعّل) — صيغة `DZHF-XXXX-XXXX-XXXX`

## 6. سير عمل النشر (مهم لأي تغيير)

```bash
# من داخل /opt/dzhoot/server (المصدر النشط على الخادم):
sudo env ENV_FILE=/etc/dzhoot/.env.production ./scripts/deploy/deploy-production.sh          # dry-run
sudo env ENV_FILE=/etc/dzhoot/.env.production ./scripts/deploy/deploy-production.sh --apply # تنفيذ
```

- `deploy-production.sh`: preflight → فحص صحة api → mongodump (مع SHA256) → بناء الصور محليًا → `up -d` → تحقق صحي.
- **النهج الموصى به**: التغيير على GitHub (فرع + PR) → تطبيق الـ patch على `/opt/dzhoot/server` → النشر أعلاه → تحديث هذه الوثيقة. (المستودع هو مصدر الحقيقة؛ الخادم لا يحتوي مستودع git.)
- بديل كامل: `stage-release.sh <sha>` + `atomic-deploy.sh <sha> APPLY=1` (مبادلة ذرية مع rollback) — يتطلب توفر الـ commit على GitHub.
- GitHub Actions: CI على main + بناء/نشر صور GHCR عند tag أو workflow_dispatch.

## 7. ما أُنجز في 2026-08-23 (هذه الجلسة)

### مزامنة شاملة ثنائية الاتجاه (مهم)
- **GitHub → VPS**: إصلاح حالة القنوات + حدود الذاكرة + الدليل + إصلاح لاعب اللوحة — نُشرت على الإنتاج وتم التحقق منها بالـ checksums.
- **VPS → GitHub (اكتشاف حاسم)**: الخادم كان يحتوي **تحسينات الجولة السادسة كاملة غير مدفوعة للمستودع** (وحدة إدارة VOD/Series كاملة: `routes/admin-vod.js` + `vod-admin-shell.tsx` + اختباراتها، إصلاح `isActive` في `xtream-service.ts`، تصدير/استيراد الإعدادات، إصلاح حلقات المسلسلات) — منشورة على الإنتاج منذ 12:01 UTC لكنها **غير موجودة في Git إطلاقًا**، وكانت ستُفقد عند أي إعادة نشر من GitHub. **PR #30 (20de84a7)** نقلها إلى main بعد التحقق: 234/234 اختبار + typecheck نظيف.
- **التحقق النهائي**: مقارنة checksums لـ 947 ملفًا — المستودع والخادم **متطابقان 100%**.
- **درس مستفاد**: أي عمل يُنفَّذ على الخادم مباشرة يجب أن يُدفع للمستودع فورًا؛ استخدم فحص الـ checksums (أعلاه) قبل وبعد أي نشر.

### إصلاح تشغيل اللوحة — لاعب يستخدم مسار التوكن (PR #32/#33)
- **المشكلة**: القنوات تعرض "تعمل" لكن التشغيل في اللوحة يفشل (manifestLoadError). السبب: اللاعب كان يستخدم `/api/v1/stream-proxy` المعطّل في الإنتاج (410 "use a playback token").
- **الإصلاح**: `stream-player.tsx` يطلب توكن تشغيل (`POST /api/v1/tv/playback-token`، slots 0..3) ويشغّل رابط same-origin HTTPS — الـ proxy يعيد كتابة مقاطع CDN (http) إلى مسارات same-origin فيتجنب mixed-content، ويعمل مع المصادر التي تحظر IP الخادم (456) عبر الـ Relay. صفحة القنوات تمرر `channelId` (xt:/m3u:) مع `id` منفصل لـ report-play.
- **التحقق**: شغّل "SPO: Al Kass 1 HD" من اللوحة → بث مباشر حقيقي (لقطة شاشة موثقة). التطبيق يستخدم التوكن أصلًا فيعمل عبر الـ Relay.
- ملاحظة: بعض القنوات عند المصدر تعيد **شاشة سوداء** (مانيفست `black.ts` + `#EXT-X-ENDLIST`) — أي أن القناة خارج البث عند المزود وليست خللًا في المنصة (مثال: "NM: AL KASS ONE").

### التشخيص — سبب "16,635 قناة معطلة"1. **وسم dead قديم على قنوات directPlayback**: قنوات Upstream فُحصت قديمًا من الخادم (فشلت — 456)، وسمّت نفسها ميتة، ثم أُفلتت من الفحص بعد تفعيل directPlayback دون تصحيح الوسم.
2. **القناة الميتة لا تُعاد فحوصها أبدًا**: `checkAndPromote` كان يفحص غير الميتة فقط → لا تعافٍ تلقائي.
3. **مهلة الفحص 10 ثوانٍ فقط**: قنوات M3U بطيئة (11-12 ثانية) تُوسم ميتة رغم عملها.
4. **حاوية scheduler بلا مفاتيح تشفير**: `XTREAM_SECRET_KEY/JWT_ACCESS_SECRET` غير موجودة فيها → كل `m3u-sync`/`xtream-sync` مجدول يفشل بخطأ "must be configured in production".

### الإصلاحات (PR #27 و PR #28 — مدمجة في main)
| الملف | التغيير |
|---|---|
| `server/backend/src/services/stream-health-service.ts` | تطبيع قنوات directPlayback إلى working؛ إعادة فحص الـ dead بعد `STREAM_DEAD_RECHECK_HOURS` (6 ساعات)؛ مهلة الفحص `STREAM_PROBE_TIMEOUT_MS` (15 ثانية) |
| `server/docker-compose.production.yml` | scheduler يحصل على نفس مفاتيح API (تشفير + تشغيل + تنبيه/FCM)؛ رفع حد ذاكرة api/scheduler إلى **2048m** (منع OOM) |
| `server/docs/ops/direct-playback-liveness-fix.md` | توثيق السبب + العلاج اليدوي mongosh |
| `server/backend/src/services/stream-health-service.test.ts` | +3 اختبارات (تطبيع، تعافٍ، cooldown) |

### النشر والتحقق (مُنجز على الإنتاج)
- patch على `/opt/dzhoot` (4 ملفات) + `deploy-production.sh --apply` (نسخ mongodump + بناء + إعادة تشغيل — توقف ثوانٍ).
- علاج mongosh: `{directSources:1, modified:16632}` → كل قنوات Upstream أصبحت working.
- **النتائج**: failing **16,635 → 1** | M3U sync: error → **idle بدون أخطاء** | فحص الصحة: 16,639 فحصت، 1 all-dead فقط.
- حدود الذاكرة 2048m مطبقة على الحاويات (الخادم 4.2GB متاح).

## 8. المشاكل المعروفة والمتبقية (مرتبة بالأولوية)

### حرجة للاحترافية (المرحلة 0)
- [ ] **EPG**: تغطية ~9% + 13/50 مصدر فاشل (iptv-epg.org 404) — رفع التغطية وإصلاح المصادر
- [ ] **بيع الاشتراكات**: باقة واحدة مجانية، لا بوابة دفع، لا تجديد تلقائي
- [ ] **إكمال الترجمة**: 9 صفحات إدارة عربية فقط (لوحة التحكم، القنوات، VOD، المسلسلات، الاستيراد، المصادر، xtream، m3u، quick-pick)

### أمنية (من مراجعة الكود 2026-08-23 — مرجع: `docs/` وتقرير الصندوق)
- [ ] api/frontend على شبكة Docker مشتركة مع مستأجرين آخرين (عزل ضعيف) — إزالة `gkz-network` أو إضافة مصادقة Redis/Mongo
- [ ] كود تفعيل مُلغى ما زال يُقبل في `/pair` و`/verify` (إصلاح بسيط: فحص `codeRevokedAt`)
- [ ] PIN الاقتران يُسجَّل في السجلات (`tv.js`) — يجب إزالته من السجلات
- [ ] `client-redeem`: جلسة 365 يومًا + حد معدل قابل للالتفاف (deviceId)
- [ ] APK بدون R8 (لا تشويش) — إعادة التفعيل مع ترقية Media3 (1.5+)
- [ ] Parental PIN: SHA-256 بلا salt
- [ ] "Certificate pinning" معلن لكن غير منفذ فعليًا

### تشغيلية
- [ ] النسخ الاحتياطي البعيد غير مفعّل (يتطلب بيانات مزود تخزين)
- [ ] ملاحظة قانونية: المصادر الحالية (Upstream) إعادة بث لمحتوى غير مرخّص — قرار استراتيجي للمالك (البقاء مقابل التحول لمحتوى مرخّص)

## 9. وثائق مفيدة داخل المستودع

| الوثيقة | المحتوى |
|---|---|
| `PROJECT_ROADMAP.md` | خارطة التطوير والمراحل بالعربية |
| `server/PROJECT_STATUS.md` | حالة الإنتاج والتحقق |
| `server/docs/ops/UPSTREAM_RELAY_OPS.md` | بنية Relay المنزلي لمصدر Upstream |
| `server/docs/ops/direct-playback-liveness-fix.md` | إصلاح 2026-08-23 + أمر mongosh |
| `server/docs/ops/ROLLBACK_GUIDE.md` | إجراءات التراجع |
| `server/docs/API_DOCUMENTATION.md` | توثيق API |
| `AGENTS.md` | قواعد العمل للوكلاء (إلزامية) |

## 10. قواعد ذهبية عند العمل

1. **اقرأ هذه الوثيقة + AGENTS.md قبل أي تغيير.**
2. لا تنشر أسرارًا في Git أبدًا (كلها في `/etc/dzhoot/.env.production` على الخادم).
3. التغيير: فرع `fix/` أو `feat/` → PR صغير → اختبارات خضراء → دمج → نشر عبر `deploy-production.sh --apply` → **تحديث هذه الوثيقة**.
4. بعد أي تغيير جوهري (بنية/بيانات/نشر/قرار): حدّث هذا الدليل في نفس اليوم — لا تتركه متأخرًا.
5. لا تحاول مستخدمي SSH عشوائيين على الـ VPS (fail2ban يحظر بسرعة).
6. عند الشك في تأثير تغيير على البيانات: اعمل نسخة mongodump أولًا (السكربت يفعلها تلقائيًا).
