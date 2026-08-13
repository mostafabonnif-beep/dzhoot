# DZ HOOF — تقرير التطوير الاحترافي (للتسليم إلى Manus)

**التاريخ:** 2026-08-13 · **المستودع:** github.com/merci1994dz/dzhoot · **الفرع:** main (`df20384`)
**الغرض:** هذا التقرير هو المرجع الكامل للعمل على المشروع. نفّذ حزم العمل (WP) بالترتيب، واتبع `AGENTS.md` في جذر المستودع، ولا تتجاوز البنية المعتمدة.

---

## 1. ملخص تنفيذي

DZ HOOF منصة IPTV قانونية (Backend Express+TypeScript+MongoDB+Redis، لوحة تحكم Next.js، تطبيق Android Kotlin+Compose+Media3). اكتمل "العمود الفقري التجاري" والبنية الأساسية، وCI أخضر، والفحص الكامل يمر:

| الفحص | الحالة |
|---|---|
| Typecheck | ✅ 0 أخطاء |
| Lint | ✅ 0 أخطاء |
| اختبارات Backend (jest) | ✅ 149/149 |
| Smoke E2E (دورة تجارية كاملة) | ✅ 33/33 |
| CI (GitHub Actions) | ✅ أخضر (backend + frontend) |
| إعادة تسمية Android | ✅ com.dzhoof.iptv (صفر بقايا cadnative) |

**أهم الاستنتاجات:**
1. أقوى ثغرة تحقق: **تطبيق Android لم يُبنَ قط في CI** (لا job SDK) — كل تغييرات Android الحالية غير متحققة من الترجمة.
2. **الـsmoke E2E ليس في CI** — وهو كشف خطأً حقيقيًا مؤخرًا (انظر WP2).
3. **الإشعارات backend فقط** — لا FCM حقيقي.
4. **لا يوجد نشر إنتاجي** (VPS/HTTPS) رغم جاهزية Docker وbackup scripts.
5. **لا يوجد فرع develop** — العمل المتوازي (Manus + أدوات أخرى) على main مباشرة يعرض للتعارض.

---

## 2. الحالة المؤكدة (ما يعمل الآن — لا تلمسه بلا داعٍ)

- **التجارة:** Plans، Activation Codes (hash SHA-256)، Redeem (تمديد الاشتراك)، Subscriptions، Devices مع حد الأجهزة، Redemption logs، Audit log.
  - المسارات: `/api/v1/admin/plans`, `/api/v1/admin/activation-codes/*`, `/api/v1/activation/redeem`, `/api/v1/me/*`.
- **المحتوى:** استيراد Xtream Codes (اعتمادات مشفرة AES-256-GCM)، مزامنة Live/VOD/Series مع Prune، M3U/iptv-org، EPG، Movies/Series/Seasons/Episodes (موديلات + كتالوج `/api/v1/catalog/*` + بحث موحّد).
- **الأمان:** توكنات تشغيل قصيرة العمر، إخفاء اعتمادات البث، حد الاتصالات المتزامنة، PIN أبوي، بوابة اشتراك في `/streams/authorize` (تفعيلها عبر إعداد `subscription_required`)، CSRF.
- **لوحة التحكم:** صفحات Users/Channels/Categories/EPG/Movies/Series/Sources/Plans/Codes/Subscription/Stats/Activity/Scheduler/Settings + عربية RTL.
- **Android:** قنوات مباشرة، VOD/Series (أُضيف حديثًا)، EPG، مفضلة، بحث، Catch-up/Timeshift، pairing PIN/QR، قسم Subscription (تفعيل كود).
- **بنية تحتية:** Docker Compose (dev/production/selfhost)، سكربتات backup.sh + restore-drill.sh، Sentry، وثائق غنية في `server/docs/`.

---

## 3. أخطاء وملاحظات فنية قائمة (ثغرات معلّقة)

1. **`resolveUser` لا يكشف `allCatalog`/`channels`** — أُصلح في `df20384`، لكن تأكد أن أي وسيط جديد يضيفه لمستخدمي `req.user` يكشف كل الحقول التي تقرأها المسارات (راجع `src/middleware/resolveUser.ts` و `requireTvOrSessionAuth.ts`).
2. **`admin-notifications.js`:** `POST /:id/send` يعلّم `SENT` فقط — لا إرسال فعلي (معلق فيه تعليق "FCM push integration can hook in here later").
3. **المستخدم بدون اشتراك وغير مخصص له كتالوج يحصل على `CONTENT_NOT_FOUND` (404)** لروابط LIVE بدل رسالة أوضح — مقبول أمنيًا (لا يكشف وجود المحتوى)، لكن يجب أن يعرض التطبيق حالة "فعّل اشتراكك" بدل "غير موجود".
4. **CI لا يشمل smoke ولا Android** — أكبر ثغرة تحقق (تفصيل في WP1/WP2).
5. **اختبارات الواجهة ضعيفة** (ملف واحد فقط: home.test.tsx). الميزات الإدارية الجديدة (Movies/Series/Codes/Plans) بلا اختبارات.
6. **معدل تفعيل الأكواد غير محدود** — احمِ `/activation/redeem` بـrate-limit (تجربة تخمين أكواد).
7. **لا 2FA لمسؤولي اللوحة** — ضروري قبل أي استخدام تجاري.
8. **`subscription_required` افتراضيًا `false`** — قرر السياسة التجارية ووثّقها (المستخدم الذي ينوي بيع أكواد يجب أن يفعّلها في الإعدادات عند النشر).

---
## 4. حزم العمل المقترحة (نفّذ بالترتيب)

### WP1 — بناء Android في CI والتحقق من الترجمة 🔴 (أولوية قصوى)

**الهدف:** ضمان أن كل تغيير Android يُترجم فعليًا قبل الدمج.

**لماذا:** حاليًا لا job لبناء Android؛ الميزات الجديدة (VOD، parental PIN، limits) لم تُترجم أبدًا في بيئة نظيفة. الحزمة أعيدت تسميتها إلى `com.dzhoof.iptv` (gradle 8.9) — غير متحققة.

**المهام:**
1. أضف job `android` في `.github/workflows/ci.yml`:
   - `actions/setup-java@v4` (Java 17)
   - تثبيت Android SDK: `sdkmanager "platforms;android-34" "build-tools;34.0.0"` عبر cmdline-tools (أو `android-actions/setup-android@v3`)
   - `./gradlew assembleDebug --stacktrace` (working-directory: android)
   - احفظ الـAPK كـartifact (`actions/upload-artifact`)
2. أصلح أي أخطاء ترجمة تظهر (أولوية: إصلاح لا حذف الميزات).
3. أضف `./gradlew test` إذا وُجدت اختبارات JVM (SettingsViewModelTest موجود في `app/src/test`).
4. (اختياري) job `assembleRelease` بدون توقيع للكشف عن مشاكل R8/obfuscation.

**تعريف الإنجاز:** job أخضر ينتج APK قابلًا للتثبيت، وأي push مستقبلي لملفات Android يفشل البناء إن كُسرت.

---

### WP2 — إدخال Smoke E2E في CI 🔴

**الهدف:** تشغيل الدورة التجارية الكاملة تلقائيًا مع كل push.

**لماذا:** سكربت `server/backend/scripts/smoke-activation.ts` كشف خطأً حقيقيًا (`allCatalog`) لن يظهره jest العادي. يعمل محليًا فقط الآن.

**المهام:**
1. أضف خطوة في job backend:
   ```yaml
   - name: E2E smoke (subscription loop)
     run: npx tsx scripts/smoke-activation.ts
     working-directory: server/backend
   ```
2. تأكد أن `mongodb-memory-server` يحمّل ثنائي mongod في CI (سيُحمَّل تلقائيًا عند أول تشغيل؛ إن فشل، أضف `MONGOMS_SYSTEM_BINARY` أو اترك سكربتات الحزمة تعمل أثناء `npm ci`).
3. وسّع السكربت تدريجيًا: سيناريو Xtream sync (مع mock HTTP)، إشعارات، أجهزة، حد الأجهزة (موجود جزئيًا — أكمل).

**تعريف الإنجاز:** CI يفشل تلقائيًا إذا انكسرت دورة (أدمن → باقة → أكواد → تفعيل → اشتراك → تشغيل → أجهزة → إلغاء).

---

### WP3 — نشر إنتاجي (VPS + HTTPS + أتمتة) 🟠

**الهدف:** منصة حية قابلة للاستخدام التجاري.

**المهام:**
1. راجع `server/docker-compose.production.yml`: بوابات منفصلة للـAPI واللوحة، MongoDB+Redis بإعدادات آمنة (auth + volumes + backups)، حدود موارد.
2. HTTPS: Caddy (الأسهل مع Let's Encrypt) أو NGINX + certbot أمام 80/443؛ لا تترك 3000 مكشوفة.
3. أتمتة النسخ الاحتياطي: cron لـ`server/scripts/backup.sh` + نسخة دورية لمجلد uploads + اختبار `restore-drill.sh` بعد كل تغيير schema.
4. `.env.production` بأسماء متغيرة: `XTREAM_SECRET_KEY` قوية (تشفير الاعتمادات)، `JWT_*`، `SUPER_ADMIN_PASSWORD`، وقرر `subscription_required` حسب السياسة التجارية.
5. Health checks + مراقبة (Sentry موجود؛ أضف تنبيهات HTTP/SMTP لانقطاع الخدمة — `OBSERVABILITY.md` مرجع).
6. وثّق runbook نشر في `server/docs/workflow/DEPLOYMENT_GUIDE.md` (المسار موجود).

**تعريف الإنجاز:** `https://api.example.com/health` أخضر، تسجيل دخول فعلي، إضافة مصدر Xtream حقيقي + مزامنة + تفعيل كود من التطبيق، واستعادة ناجحة من نسخة احتياطية موثقة.

---

### WP4 — إشعارات FCM حقيقية 🟠

**الهدف:** إيصال الإشعارات للهواتف فعليًا.

**المهام:**
1. Android: أضف `com.google.firebase:firebase-messaging` (BOM موجود)، `FirebaseMessagingService` + `onNewToken`، وسجّل التوكن عند الخادم (أضف حقل `pushToken` إلى `POST /api/v1/me/devices` أو مسار `/me/push-token`).
2. Backend: خدمة إرسال FCM (HTTP v1 مع service account JSON كـenv var، أو legacy API)، واربطها بـ`admin-notifications.js /send` و`/me/notifications` (أعد `unreadCount`).
3. `google-services.json` يبقى **خارج git** (مؤكد gitignored) — وثّق خطوة وضع الملف في runbook البناء.
4. Deep link: اجعل `deepLink` في الإشعار يفتح قناة/فيلم داخل التطبيق.

**تعريف الإنجاز:** إشعار من اللوحة يصل لهاتف فعلي خلال ثوانٍ، مع حالة قراءة متزامنة.

---
### WP5 — فرض بوابة الاشتراك في التطبيق من طرف لطرف 🟠

**الهدف:** المستخدم بلا اشتراك نشط لا يشاهد، وتجربة "فعّل كودك" واضحة.

**المهام:**
1. تأكد أن تطبيق Android يستدعي `POST /streams/authorize` قبل كل تشغيل (Live/Movie/Episode) ولا يستخدم رابط المصدر الخام (راجع `PlayerScreen`/`PlayerViewModel` ومصدر `tv/playback`).
2. عند `403 SUBSCRIPTION_EXPIRED` أو `PLAYBACK_DEVICE_REQUIRED`: اعرض شاشة/حوار "اشتراكك انتهى — فعّل كودًا" مع زر يفتح قسم Subscription (الموجود في Settings).
3. سجّل الجهاز (`POST /me/devices`) عند أول تشغيل، واعرض حد الأجهزة في قسم الاشتراك (موجود — أكمل الربط).
4. قرر وسلّم للخادم `subscription_required: true` عبر `PUT /api/v1/admin/app-settings` في بيئة الإنتاج.

**تعريف الإنجاز:** حساب تجريبي بلا اشتراك يُمنع من التشغيل برسالة واضحة؛ حساب بباقة فعّالة يشاهد؛ إلغاء الجهاز يحرر خانة فورًا.

---

### WP6 — صقل إدارة Xtream/VOD في اللوحة 🟠

**الهدف:** اكتمال حلقة إدارة المحتوى.

**المهام:**
1. صفحة إدارة مصادر Xtream (`/admin/xtream-sources`): إنشاء (serverUrl/user/pass)، اختبار اتصال، زر Sync مع مؤشر `syncStatus`/`lastError`/`lastSyncAt`/stats.
2. في صفحات Movies/Series الموجودة: أضف فلتر مصدر، حالة المحتوى المعطّل (isActive)، وزر إعادة مزامنة.
3. مؤشرات خطأ واضحة عند فشل المزامنة (حاليًا `syncStatus: 'error'` + `lastError` في الـmodel — اعرضهما).
4. (تحسين) جدولة مزامنة تلقائية دورية (cron-style عبر scheduler الموجود).

**تعريف الإنجاز:** إضافة مصدر Xtream → اختبار → مزامنة → ظهور قنوات/أفلام/مسلسلات في اللوحة والتطبيق، مع ظهور الأخطاء بوضوح.

---

### WP7 — تحصين الأمان (قبل الإطلاق التجاري) 🔴

**الهدف:** تقليل مخاطر السرقة/الاحتيال في منتج تجاري.

**المهام:**
1. **2FA للمشرفين**: TOTP (otplib) + صفحة تفعيل في اللوحة + فرض اختياري.
2. **Rate-limit** على `/activation/redeem` (مثلاً 5 محاولات/10 دقائق/IP + لكل مستخدم) و`/auth/login`.
3. **Device lock** (اختياري لكل باقة): ربط الاشتراك بأول جهاز يفعّل (حقل `lockedDeviceId` في Subscription) — فكرة من XtreamPulsar (BSL — تنفيذ ذاتي).
4. **VPN/DC IP blocking** اختياري لكل باقة (قاعدة IP datacenter + GeoIP) — يقلل إعادة البث.
5. **منع تخمين الأكواد**: الـhash SHA-256 مع `codeLast4` للبحث — لا تسريب؛ أضف تأخيرًا/rate-limit (أعلاه) وفكّر بفترة سريان للكود (`codeExpiresAt` موجود — استخدمه افتراضيًا).
6. مراجعة أمنية: `npm audit` (41 ثغرة معلنة — منها حرجة)، ترقية `multer` (إصدار قديم بثغرات معروفة).

**تعريف الإنجاز:** قائمة فحص أمني موثقة، واللوحة تتطلب 2FA، والتخمين محجوب، ووثيقة `server/docs/security/` محدثة.

---

### WP8 — لغات FR/EN كاملة + تحسينات تجربة 🟡

**المهام:**
1. ملفات i18n كاملة (العربية تمت؛ أضف الفرنسية والإنجليزية) للوحة والتطبيق.
2. حالات Loading/Empty/Error موحدة في كل الشاشات الجديدة (Skeleton بدل "Loading...").
3. توحيد الألوان/الخطوط عبر Design Tokens (يوجد قرار `002-unified-color-palette.md` — طبّقه على الصفحات الجديدة).

---

### WP9 — نظام الموزعين (V2 — بعد الاستقرار) 🟡

**الأساس موجود:** `ActivationCode.resellerId` + `ActivationRedemption` + audit. نفّذ لاحقًا:
1. موديل Reseller (رصيد، عمولة)، لوحة موزع منفصلة، تخصيص أكواد لموزع، تقارير.
2. مرجع الأفكار: XtreamPulsar (`reseller`, `commission`, `invoice`) — **أفكار فقط** (رخصة BSL 1.1: ممنوع نقل الكود؛ التشغيل الذاتي الشخصي مسموح لكن المنتج التجاري المستضاف ممنوع بدون رخصة).

---

### WP10 — موثوقية وتوسع (مستمر) 🟡

1. **Git workflow**: أنشئ `develop` + سياسة `feature/*` كما في PROJECT_ROADMAP — ضروري للعمل المتوازي (Manus + أدوات أخرى) وتجنب التعارض.
2. **Redis**: استخدمه بجدية للكاش (catalog, EPG) وحدود المعدلات والـqueues (يوجد `services/redis.ts` — فعّل التخزين المؤقت للكتالوج).
3. **مراقبة التشغيل**: احفظ إحصاءات التشغيل (StreamPlayReport موجود) واعرضها في Stats.
4. **ترقية اعتماديات**: `multer@1.x` (ثغرات معروفة) → 2.x؛ راجع `npm audit` دوريًا.
5. **اختبارات الواجهة**: أضف اختبارات RTL للصفحات الإدارية الجديدة (Codes/Plans/Movies/Series) — الحد الأدنى: عرض القائمة وحالة فارغة.

---

## 5. خارطة طريق مقترحة (بالترتيب الزمني)

| الأسبوع | الحزم | المخرجات |
|---|---|---|
| 1 | WP1 + WP2 | Android يُبنى في CI + smoke تلقائي |
| 2 | WP3 | نشر إنتاجي HTTPS + backup مؤتمت |
| 3 | WP4 + WP5 | إشعارات فعلية + فرض الاشتراك في التطبيق |
| 4 | WP6 + WP7 | إدارة Xtream كاملة في اللوحة + تحصين أمني (2FA/limits) |
| 5-6 | WP8 + WP10 | لغات + CI/Redis/اختبارات/ترقية اعتماديات |
| لاحقًا | WP9 | موزعون (بعد استقرار الإصدار الأول) |

---

## 6. ملاحظات خبير IPTV (قواعد لا تُنتهك)

1. **لا تمرّر الفيديو عبر Node.js أبدًا** — البث المباشر يستهلك bandwidth هائلًا. النموذج الصحيح: روابط موقّعة قصيرة العمر (مُنجز) → المصدر/CDN مباشرة. عند الكبر: origin + CDN أمام السيرفر.
2. **HLS هو الأساس** (مُنجز)؛ DASH لاحقًا فقط عند الحاجة. Catch-up عبر `catchup-source`/timeshift (مُنجز — حافظ عليه).
3. **حقوق المحتوى مسؤولية المشغّل**: المنصة أداة؛ أي مصدر يُضاف يجب أن يكون مرخّصًا. لا تُضف قوائم "مجانية" مشكوكًا فيها داخل المنتج نفسه.
4. **الرخص**: MIT/Apache = يمكن الأخذ مع الحقوق؛ GPL/BSL = أفكار فقط. المرجعيات: AerioTV (MIT)، Ultra TV (MIT)، clubTivi (Apache)، XtreamPulsar (BSL — أفكار فقط).
5. **الأسرار**: لا `google-services.json` ولا `.env` في git (مؤكد). `XTREAM_SECRET_KEY` في الإنتاج مختلفة عن التطوير (وإلا فك تشفير الاعتمادات المخزنة يفشل).
6. **التوكنات القصيرة العمر**: أبقِ صلاحيتها ثواني/دقائق لا ساعات؛ فسخها عند تغيير كلمة مرور/تعليق المستخدم.
7. **مقياس النجاح** (من مواصفة المشروع): المسار الكامل أدمن→مصدر→مزامنة→باقة→كود→تفعيل→جهاز→تشغيل→EPG→سجل→رؤية الأدمن، مع حالات الفشل (انتهاء اشتراك، كود مستخدم، جهاز زائد، مصدر متوقف).

---

## 7. ما يجب على Manus فعله فورًا (قائمة فحص أول 48 ساعة)

- [ ] `git pull` (التأكد من `df20384`)
- [ ] تشغيل `npm run typecheck && npm run lint && npm run test:backend` في `server/` (يجب أن تمر 149)
- [ ] تشغيل `npx tsx scripts/smoke-activation.ts` في `server/backend` (يجب أن تمر 33)
- [ ] WP1: job Android في CI — وإصلاح أخطاء الترجمة حتى `assembleDebug` ينجح
- [ ] WP2: إضافة smoke إلى CI
- [ ] قراءة `server/docs/PLAYBACK_SECURITY.md` و`server/docs/OBSERVABILITY.md` قبل أي تغيير أمني
- [ ] لا تعدّل موديلات/مسارات التجارة (`plans/activation-codes/subscriptions/devices`) دون تشغيل اختباراتها

---
<!-- END -->



---

## ⚠️ ملحق عاجل — الفحص الحي للوحة المنشورة (2026-08-13)

فحصت النسخة الحية (نشر Manus) بحساب superadmin. **النتيجة: 10 من 19 قسمًا في لوحة التحكم تعيد HTTP 502** بينما الـBackend سليم (كل endpoints الـAPI ترجع 200).

**تعمل (200):** لوحة التحكم، الباقات، أكواد التفعيل، مصادر Xtream، المستخدمون، الأجهزة، الإعدادات، القنوات، الإحصائيات.

**مكسورة (502):** الأفلام (VOD)، المسلسلات، اختيار سريع، سجل النشاط، جدول المهام، دليل البرامج EPG، استيراد IPTV، إصدارات التطبيق، مصادر M3U التلقائية، مصادر أخرى.

**الأرجح:** خطأ تقديم من جهة الخادم (SSR) في هذه المسارات — بناء Next.js ينجح لكن الصفحات تنهار وقت الطلب (فشل استيراد، مكوّن مكسور، أو fetch غير محمي). `next build` لا يكشف أخطاء التشغيل — لهذا CI أخضر والمشكلة حية.

**المطلوب فورًا:**
1. شخّص بـ `docker compose logs` على المنصة المنشورة/محليًا (`next start` ثم فتح المسارات المكسورة).
2. أصلح كل مسار حتى يرجع 200 ويعرض محتوى.
3. **أضف اختبار E2E (Playwright موجود في `server/` — `playwright.config.ts` + مجلد `e2e`)**: سيناريو دخول → زيارة كل مسار من المسارات الـ19 → تأكد أن كلها تعرض محتوى. هذا يمنع تكرار الكارثة.
4. أضف خطوة `next build && start` + فحص مسارات في CI (job frontend) — أو على الأقل شغّل Playwright في CI.
5. أبلغ المستخدم فورًا إذا كانت المشكلة في كود حديث (مثل commit "modernize UI") ليتحقق منه.

**ملاحظات إضافية من الفحص الحي:**
- كلمة مرور superadmin في المنصة المنشورة هي الافتراضية (`ChangeMeNow123!`) — غيّرها وأضف إجبار التغيير.
- صفحة مصادر Xtream موجودة (إضافة مصدر + تشفير) — أكمل أزرار Test/Sync لكل مصدر وعرض الأخطاء.
- لا توجد صفحة إشعارات في اللوحة بعد.
- لا توجد صفحة 2FA/أمان في الإعدادات.
