# تقرير التسليم — جلسة 2026-08-23 (مساءً)

> **اقرأ هذا أولًا، ثم `FINAL_REPORT_2026-08-23_AR.md` و`PROJECT_STATE_HANDBOOK_AR.md`** — هذا التقرير يلخص جلسة العمل المسائية (بعد التقرير النهائي الصباحي) وما تم فيها وما تبقى، ليعرف أي وكيل/شخص قادم من أين يبدأ دون إعادة فحص.

---

## 1. ملخص تنفيذي

جلسة المساء ركّزت على ثلاث جبهات، كلها **مكتملة ومُتحقق منها ومنشورة**:

| الجبهة | المشكلة | النتيجة |
|---|---|---|
| **الوصول للسيرفر** | كلمة مرور root معطّلة على SSH | ✅ مفتاح `dzhoof-admin@vps` الخاص يعمل (المستخدم `dzhoof-admin` + sudo بدون كلمة مرور) — أُضيف مفتاح بيئتي أيضًا |
| **تطبيق Android لا يشغّل القنوات** | آخر APK موقع v1.0.6 (R8 حذف وحدات Media3 HLS) — إصلاحات v1.0.7–1.0.9 لم تُبنَ أبدًا | ✅ **بُني APK رسمي موقّع v1.0.9** (إصلاح HlsMediaSource الصريح) ونُشر للتحميل |
| **دليل البرامج (EPG) ناقص** | 81% من القنوات بدون tvgId + المزامنة تمحو التعيينات + مطابقة حساسة للحالة + مصدر iptv-org بعناوين "No Data" | ✅ **عناوين EPG حقيقية** لقنوات beIN التركية (TRI BEIN SPORTS GOLD تعرض "beIN Süper Lig"...) — 3 جولات إصلاح ومنشورة |

**المزامنة**: المستودع (GitHub `main`) متطابق مع كل التعديلات — 4 commits جديدة؛ الخادم منشور بآخرها (3 عمليات نشر آلي).

---

## 2. الوصول والبنية (مهم للجلسات القادمة)

- **SSH**: `ssh dzhoof` (من بيئة الوكيل) = `dzhoof-admin@5.135.79.221` بمفتاح `/home/user/.ssh/dzhoof-admin` (المفتاح الخاص الذي رفعه المستخدم، تعليقه `dzhoof-admin@vps`).
- **صلاحيات**: `dzhoof-admin` في مجموعة sudo مع `NOPASSWD: ALL` — كل أوامر النشر تُشغَّل `sudo`.
- **بيئة الإنتاج**: `/etc/dzhoot/.env.production` (chmod 600). المصدر: `/opt/dzhoot/server` (نسخة ملفات، **ليست git**). الحاويات: api / frontend / scheduler / redis / caddy / mongodb (أسماء `dzhoof-*`).
- **النشر الآلي**: `cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply` (نسخ احتياطي + بناء + ترقية + تحقق صحة + تسجيل في `/var/log/dzhoof-deploys.log`).
- **GitHub push**: استخدمنا توكن الخادم `/etc/dzhoot/github.token` (مستخدم المستخدم نفسه).
- **IP بيئتي الصادر**: `136.118.71.205` — قد يُحظر من fail2ban عند كثرة محاولات SSH الخاطئة (حدث ذلك؛ المستخدم فكّه بـ `fail2ban-client unban 136.118.71.205`). **لا تجرّب أسماء مستخدمين كثيرة.**

---

## 3. إعادة بناء التطبيق (APK v1.0.9)

- **السبب الجذري**: v1.0.6/v1.0.7 بُنيت بـ R8 minify فحذف وحدات Media3 HLS من الـ APK؛ v1.0.8 عطّلت minify لكنها اعتمدت على تخمين نوع الحاوية؛ **v1.0.9** (commit `ac1f757`) يفرض `HlsMediaSource` صراحةً — كان في main لكن **لم يُبنَ منه APK قط**.
- **التنفيذ**: زامنت `android/` من main إلى `/opt/dzhoot/android` (انتبه: الاستخراج يحتاج `--strip-components=1` لأن أرشيفي يحمل بادئة `android/`)، ثم بنيت:
  ```bash
  sudo bash -c 'source /etc/dzhoot/android-signing/signing.env; export ANDROID_HOME=/opt/android-sdk DZHOOF_API_URL=https://iptv.ld-11.net/; cd /opt/dzhoot/android && ./gradlew assembleRelease -PversionName=1.0.9'
  ```
- **المخرجات** (مُتحقق منها): `com.dzhoof.iptv` versionCode 10009، موقّع بشهادة الإنتاج (CN=DZ HOOF IPTV)، فئات `HlsMediaSource` موجودة في classes3.dex.
- **الأماكن**:
  - الخادم: `/var/backups/dzhoot/apks/DZ-HOOF-TV-v1.0.9-official-signed.apk` (sha256 `5a4b56ef…`)
  - تحميل مباشر: `https://iptv.ld-11.net/downloads/dzhoof-v1.0.9.apk` (200 ✓)
- **إصلاح جانبي**: مجلد `/downloads` في Caddy كان مفقودًا بعد نشر ذرّي سابق (كان في `/opt/dzhoot.previous-*` فقط) — أُعيد إنشاؤه + `--force-recreate caddy`، وأُضيف `server/downloads/.gitkeep` (commit `922d9db`) كي لا يضيع مستقبلًا.
- **التحقق الحي للتشغيل**: جهاز المستخدم سجّل `startup_success` متعددة (أحدها 0.9s) وشاهد مقاطع حتى #94؛ قناة TRI BEIN SPORTS GOLD اختُبرت من الخادم: توكن/مانيفست/مقطع كلها 200 (7.1MB MPEG-TS). **زمن بدء 10-15s لقنوات NEO = زمن استجابة المزود عبر الوكيل، وليس خللًا.**

---

## 4. إصلاح EPG (3 جولات — كلها في main ومنشورة)

### الجولة 1 — المصادر والتعيينات
- **المشكلة**: 13,552/16,639 قناة (81%) بلا tvgId؛ ملفات iptv-epg.org للمغرب العربي (`epg-dz/ma/tn/jo`) تعيد **404** (غير موجودة أصلًا).
- **التنفيذ**: أُضيفت `EPG_EXTRA_SOURCES` إلى `/etc/dzhoot/.env.production` (نسخة احتياطية `.bak-pre-epgfix-*`):
  ```dotenv
  EPG_EXTRA_SOURCES=[{"url":"https://epgshare01.online/epgshare01/epg_ripper_TR1.xml.gz","label":"epgshare-bein-tr"},{"url":"https://epgshare01.online/epgshare01/epg_ripper_BEIN1.xml.gz","label":"epgshare-bein-intl"}]
  ```
  (epgshare TR1 = دليل beIN التركي بعناوين حقيقية؛ BEIN1 = قنوات beIN/Alkass الدولية. الموثق في `server/.env.production.example`.)

### الجولة 2 — تعيينات تبقى + مطابقة غير حساسة للحالة
- **المشكلة**: xtream/m3u sync تمسح tvgId (`$set` إلى `''`)؛ والمطابقة في الخادم حساسة للحالة (`beINSports1.tr` ≠ `beINSPORTS1.tr`) بينما التطبيق وفحص التغطية غير حساسين.
- **الشفرة** (commits `6800f11`):
  - `xtream-service.ts` / `m3u-service.ts`: الحفاظ على tvgId اليدوي عند غياب قيمة المزود.
  - `tv.js` (loadEpgChannelIds + بناء الحمولة): مطابقة case-insensitive.
  - `epg-service.ts` (getEpgForChannels): `.collation({ locale: 'en', strength: 2 })`.

### الجولة 3 — عناوين حقيقية بدل "No Data"
- **المشكلة**: مصدر iptv-org التركي يعطي 72 خانة "No Data" لكل قناة beIN (عناوين فارغة)؛ البيانات الحقيقية في TR1 لكن بمعرّفات مختلفة (`Beinsports.tr` بدل `beINSports1.tr`).
- **الشفرة** (commit `48f9559`): tvgId الآن `$setOnInsert` فقط في `xtreme-service.upsertChannel` — **التعيين اليدوي ينتصر دائمًا**، والمزود يُستخدم عند الإدراج فقط.
- **البيانات**: مجموعة `TR| BEIN SPORTS GOLD` (37 قناة) رُبطت بمعرّفات TR1:
  - `Beinsports.tr` ×11 (شاملة "## TR| BEIN SPORTS GOLD" بكل نسخه) — برامج حقيقية
  - `Beinsports.2.tr` ×5، `Beinsports.3.tr` ×4، `Beinsports.4.tr` ×4
  - `beIN.SPORTS.HABER.HD.tr` ×1 (18 برنامجًا)
  - `beIN.SPORTS.MAX.1/2.tr` ×8 — بلا بيانات في TR1
  - `beINSports5.tr` ×4 — بلا بيانات في TR1
- **التحقق**: حمولة EPG للمستخدم الآن: "TRI BEIN SPORTS GOLD" → 9 برامج بعناوين حقيقية ("beIN Süper Lig"، "Trio"، "1 Yıldız 10 Gol")؛ HABER 18؛ SPORTS 2-4 بـ 8-13. إجمالي القنوات بدليل: **584 → 980+**.

### عمليات النشر الثلاث (كلها `DEPLOY COMPLETE` + صحة سليمة)
| النسخة | التوقيت | المحتوى |
|---|---|---|
| v1.0.1-20260823T200010Z | 20:00 UTC | جولة 1+2 (مصادر + حفظ tvgId + case-insensitive) |
| v1.0.1-20260823T200818Z | 20:08 UTC | collation + خريطة المعلومات |
| v1.0.1-20260823T212644Z | 21:26 UTC | الأولوية للتعيين اليدوي (setOnInsert) |

---

## 5. حالة الإنتاج الحالية (مُتحقق 2026-08-23 ليلًا)

- 6 حاويات صحية؛ API 1.0.1؛ `/health/live` + `/health/ready` سليمان (MongoDB + Redis متصلان).
- 16,639 قناة | 55 مستخدمًا | EPG: 118K+ برنامجًا، ~980 قناة بدليل.
- نسخ احتياطي: mongodump يومي + نسخ deploy تلقائية + restic config.
- قرص 63% | ذاكرة 4.2G متاحة.

---

## 6. ما تبقى (خارطة القادم — بالترتيب المقترح)

### أمني (عاجل — كلمات المرور ظهرت في المحادثة)
- [ ] **تغيير كلمة مرور root** على السيرفر (كلمة `jU2NDk5ODlmZ` مكشوفة في المحادثة).
- [ ] **تغيير كلمة مرور admin** للوحة الإدارة (مكشوفة أيضًا) — يمكن عبر `POST /api/v1/auth/login` + تحديث من اللوحة أو DB.
- [ ] مراجعة `github.token` في `/etc/dzhoot/` (استُخدم للدفع — تدويره اختياري).

### EPG
- [ ] **beIN SPORTS 5 + MAX 1/2**: معرّف المزود `beINSports5.tr` / `beINSportsMax1.tr` لا يطابق أي دليل ببيانات حقيقية — البحث عن مصدر يغطيها (مثل ملفات epgshare أخرى أو TR3 — فُحص TR3 بلا beIN).
- [ ] **القنوات العربية/الجزائرية**: ملفات iptv-epg.org لـ dz/ma/tn/jo غير موجودة (404) — إيجاد مصدر عربي شامل (خيارات: epgshare `SA2` (41 قناة سعودية: SSC/MBC — صغير وسليم)، أو `BEIN1`، أو مصادر عربية أخرى). ملاحظة: `epg_ripper_AR1.xml.gz` هو **أمريكا اللاتينية** وليس عربيًا — لا تُضِفه.
- [ ] تعطيل/تنظيف المصادر الـ 13 الفاشلة (404) عبر `epgsourceoverrides` (التعطيل اليدوي موجود: `disabled: true` + `lastError`) لتقليل ضجيج السجلات.

### كتالوج/قنوات
- [ ] القناة المعطلة الواحدة في الكتالوج (بانر اللوحة) + نسخ "NM:" المكررة الميتة.
- [ ] الـ 40 بثًا "متوقفًا" في فحص liveness: **متوقع** لأن المزود (Business Cloud NEO) يحجب IP الداتاسنتر — القياس الخادمي مستحيل، تُقاس بفشل التشغيل الفعلي (موثق في FINAL_REPORT الصباحي PR #27).

### تطبيق/إصدار
- [ ] إعادة تفعيل R8 مع keep-rules صحيحة لتقليص الـ APK من 77MB (الإصلاح الحالي عطّل minify كليًا — commit `df921d3`).
- [ ] ترقية Media3 (1.5+) كما في خارطة الطريق.
- [ ] رفع الـ APK إلى صفحة إصدارات GitHub (حاليًا على الخادم + رابط /downloads فقط).

### أعمال خارطة الطريق (من FINAL_REPORT الصباحي)
- [ ] بوابة دفع + باقات فعلية | نظام ريسيلر | إكمال الترجمة العربية | EPG عربي شامل.

---

## 7. أوامر سريعة للجلسة القادمة

```bash
ssh dzhoof                                   # دخول السيرفر (مفتاح dzhoof-admin)
# فحص الصحة: curl https://iptv.ld-11.net/health/ready
# تحديث EPG يدويًا (من بيئة الوكيل):
#   POST /api/v1/scheduler/trigger/epg-refresh  (X-Session-Id للمستخدم admin)
# نشر: cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply
# بناء APK: راجع القسم 3 أعلاه
# تحميل APK: https://iptv.ld-11.net/downloads/dzhoof-v1.0.9.apk
```

**الذاكرة الدائمة**: `/home/user/.workspace/memory/wiki/dzhoot-project.md` + يوميات `memory/2026-08-23.md` في بيئة الوكيل — تُحدَّث بعد هذه الجلسة.
