# تقرير التسليم — DZ HOOF IPTV (جلسة 2026-08-25/26)

> **اقرأ هذا أولًا.** هذا الملف الوحيد الذي تحتاجه لبدء العمل على المشروع.
> يغطي: الوصول الكامل، كل ما أُنجز، حالة الإنتاج الحالية، ما تبقى، وأوامر البناء والنشر.

---

## 1. الملخص التنفيذي

| الجبهة | الحالة |
|---|---|
| **الإنتاج (VPS)** | ✅ منشور `v1.0.1-20260826T110732Z` — 6 حاويات healthy |
| **تطبيق Android** | ✅ **v1.0.15** موقّع بشهادة الإنتاج، منشور في `/downloads` + التحديث الأوتوماتيكي مفعّل |
| **التصميم** | ✅ إعادة تصميم كاملة — الهوية الجزائرية (أخضر/أحمر/ذهبي) + خطوط عربية |
| **وضع الديمو** | ✅ يعمل: `{"code":"DEMO"}` → 36 قناة جزائرية |
| **GitHub** | ⏳ commit محلي جاهز — لم يُرفع بعد (انظر §5) |
| **الاختبارات** | ✅ باك-إند: 45/45 مجموعات، 335/335 اختبار نجحت + tsc نظيف |

---

## 2. الوصول (كل الصلاحيات)

| المورد | القيمة |
|---|---|
| **SSH** | `dzhoof-admin@5.135.79.221` — مفتاح ed25519 (نسخة: `/home/user/.workspace/dzhoot/dzhoof-admin-key` أو عند المستخدم). sudo بكلمة مرور root: `jU2NDk5ODlmZ` |
| **GitHub** | `mostafabonnif-beep/dzhoot` — **PAT في `/etc/dzhoot/github.token` على الخادم** (استعملها للرفع) |
| **الإنتاج (كود)** | `/opt/dzhoot/server` (النسخة العاملة) + `/etc/dzhoot/.env.production` |
| **لوحة الأدمن** | `https://iptv.ld-11.net/admin` — `admin` / `DZHOOF-b358a74599573e6e84ae7bcf18ab37da` ⚠️ **مكشوفة — غيّرها (أولوية أمنية)** |
| **قاعدة البيانات** | حاوية `dzhoof-mongodb` — القاعدة **`dzhoof-iptv`** |
| **التوقيع (APK)** | keystore: `/etc/dzhoot/android-signing/dzhoof-production.jks` + `signing.env` (4 متغيرات) |
| **التحميلات** | `/downloads` على السيرفر → `https://iptv.ld-11.net/downloads/` |

---

## 3. ما أُنجز في هذه الجلسة

### 3.1 إعادة تصميم كاملة — الهوية الجزائرية 🇩🇿
- **الألوان**: DzGreen (أخضر العلم) + DzRed (أحمر العلم) + DzGold + أسطح Atlas/Sand — في التطبيق (`Color.kt`, `colors.xml`) والواجهة (`globals.css`)
- **الخطوط العربية**: Cairo (نصوص) + Noto Kufi Arabic (عناوين) — التطبيق، الواجهة، الإيميلات
- **زوايا أنعم** (كروت 14dp)، عناوين أقسام بشريط متدرج أخضر→ذهبي
- **شارات "مباشر" حمراء نابضة** (كروت، الرئيسية، المشغل)
- **حركة Ken Burns** على البطل (تُتخطى مع reduceMotion)
- **شريط سفلي عائم حديث** (هاتف، 5 أزرار) + حذف "الدليل" (EPG) من التنقل (توفير طاقة/إنترنت)

### 3.2 وضع الديمو 🧪
- Backend: `GET /api/v1/app/demo-code` → `{"code":"DEMO"}` + كود DEMO يمر في `requireTvOrSessionAuth` + كتالوج منقّى (مجموعة "AR| ALGERIA الجزائر" — 36 قناة؛ قابلة للضبط عبر `DEMO_CHANNEL_GROUPS`/`DEMO_CHANNELS_MAX`)
- App: شريط "وضع الديمو" أعلى الرئيسية + المفضلة معطلة في الديمو

### 3.3 مترجم التصنيفات الذكي 📂
- `CategoryLocalizer.kt`: يحوّل أسماء مجموعات Xtream الخام ("AFR| AFRICA ⱽᴵᴾ ᴴᴰ/ᴿᴬᵂ") إلى عربية نظيفة (أفريقية، تركية، أطفال، جزائرية...) + كاش أداء (18k قناة)
- **مبدأ مهم**: الخام للفلترة + المترجم للعرض فقط (كان خطأ حرج: التصنيفات لا تظهر — أُصلح في v1.0.14)

### 3.4 تنظيم وتحسينات 📊
- التصنيفات: الأكثر قنوات أولًا + إخفاء أقل من 3
- الرئيسية: أعلى 10 تصنيفات فقط (أقصر وأسرع)
- عناوين القنوات مع العدد: "أطفال (350)"
- إزالة براندينغ قديم (FireVision/flame) + دومينات قديمة (tv.cadnative.com → iptv.ld-11.net)

### 3.5 التحديث الأوتوماتيكي 📲
- مفعّل بالكامل: التطبيق يفحص `/api/v1/app/version` بعد الشاشة → شاشة "تحديث" بملاحظات عربية → تحميل + تحقق توقيع + تثبيت
- **للإصدارات الجديدة**: ابنِ APK موقّع → ضعه في `/downloads` → أضف الإصدار من لوحة الأدمن (إصدارات التطبيق) → كل الأجهزة القديمة تُحدَّث تلقائيًا

---

## 4. حالة الإنتاج (مُتحقق منها 2026-08-26)

- الحاويات: api / frontend / scheduler / caddy / redis / mongodb — كلها healthy
- الديمو: `GET /api/v1/app/demo-code` → `{"code":"DEMO"}`، قنوات DEMO = 36
- التحديث: `/api/v1/app/version?currentVersion=10014` → `updateAvailable:true`, latest 1.0.15
- APKs في `/downloads`: `dzhoof-v1.0.15.apk` (SHA `6ac34d4a...`) + `DZHOOF-newdesign-debug.apk`
- الواجهة: التصميم الأخضر الجديد حي (CSS فيه `059669`)

---

## 5. ما تبقى (قائمة المهام لـ Manus)

1. **رفع GitHub** (الأهم): commit المحلي `24ba2e5` (تصميم+ديمو) + `96b2c05` (فلترة) + آخر commit (تنظيم) — ارفعهم بـ PAT من `/etc/dzhoot/github.token`:
   ```bash
   git remote set-url origin https://x-access-token:$(cat /etc/dzhoot/github.token)@github.com/mostafabonnif-beep/dzhoot.git
   git push origin main
   ```
   بعدها CI يشغّل الاختبارات (كلها نجحت محليًا) — راجع `Actions` على GitHub.
2. **أمان**: غيّر كلمة مرور الأدمن (مكشوفة في تقرير سابق) + فعّل 2FA.
3. **تحسينات مقترحة**: ترتيب/بحث داخل قائمة القنوات الكاملة، تنظيم المفضلة، تجربة البحث، شاشة الإعدادات الحديثة، النسخة العربية للـ release notes.
4. **ملاحظة بنية**: caddy لا يُعاد إنشاؤه في النشر (`--no-deps api frontend scheduler`) — يبقى يخدم `/downloads` من `/opt/dzhoot.previous-*/` القديم حتى يُعاد إنشاؤه يدويًا.

---

## 6. أوامر البناء والنشر (المثبتة)

### APK موقّع (على VPS، في `/tmp/dz-build/android` بعد مزامنة المصدر):
```bash
cd /tmp/dz-build/android
echo "PASSWORD" | sudo -S bash -c "set -a; source /etc/dzhoot/android-signing/signing.env; set +a; \
  ANDROID_HOME=/opt/android-sdk JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
  ./gradlew :app:assembleOfficialRelease -PdzhoofApiUrl=https://iptv.ld-11.net/ -PversionName=X.Y.Z --no-daemon"
```
⚠️ **مهم**: `-PversionName` إلزامي (بدونه يبني 1.0.10!) + يجب `source signing.env` داخل `sudo bash -c` (وإلا `storeFile` ناقص).

### النشر (backend + frontend):
```bash
cd /opt/dzhoot/server && sudo bash scripts/deploy/deploy-production.sh --apply
```
(dry-run بدون `--apply` أولًا). النسخ الاحتياطي mongodump تلقائي.

### إضافة إصدار للتحديث الأوتوماتيكي:
```bash
# انسخ APK إلى المجلدين:
sudo cp apk.apk /opt/dzhoot/server/downloads/dzhoof-vX.Y.Z.apk
sudo cp apk.apk /opt/dzhoot.previous-*/server/downloads/dzhoof-vX.Y.Z.apk
# ثم أضف السجل في لوحة الأدمن (إصدارات التطبيق) أو mongosh
```

---

## 7. مزالق تعلمناها (لا تكررها)

1. **mongosh بالاقتباسات المتداخلة ينكسر** — اكتب JS في ملف ثم `docker exec -i dzhoof-mongodb mongosh < file.js`
2. **tar بأسماء مسارات** — استخرج من الجذر الصحيح (وإلا `android/android` متداخل)
3. **`ChannelRow` في نفس حزمة `screens.home`** — لا تُضف import له من components
4. **بعد `sudo` build** تصبح ملفات البناء ملك root — `chown -R dzhoof-admin` قبل البناء التالي
5. **أسماء التصنيفات**: الخام للفلترة (DAO يقارن `categoryId` الخام)، المترجم للعرض فقط
