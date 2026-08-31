# دليل إصدار APK موقّع (SIGNED RELEASE RUNBOOK)

> الحالة: **كل المتطلبات جاهزة** (keystore + كلمات المرور + workflows) — الخطوة الوحيدة المتبقية: إضافة الأسرار إلى GitHub ثم تشغيل الإصدار.

## ما هو جاهز (تم التحقق منه 2026-08-21)

| المكوّن | الحالة |
| --- | --- |
| Keystore الإنتاج | `/etc/dzhoot/android-signing/dzhoof-production.jks` (JKS صالح، magic `feedfeed`) |
| كلمات المرور | `/etc/dzhoot/android-signing/signing.env` (4 قيم مكتملة: KEY_STORE / STORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD) |
| Workflow تلقائي | `android/.github/workflows/release.yml` — يعمل عند دفع tag بصيغة `v*` |
| Workflow يدوي | `.github/workflows/release-candidate.yml` — تشغيل يدوي مع `version_name` و`api_url` |
| إعداد التوقيع في Gradle | `android/app/build.gradle.kts` يقرأ `SIGNING_*` من البيئة |

**ناقص فقط:** 5 أسرار/متغيرات في إعدادات الريبو (GitHub → Settings → Secrets and variables → Actions).

## 1. تجهيز قيم الأسرار (على الخادم)

نفّذ على الخادم `5.135.79.221` (لا تطبع كلمات المرور في سجلات عامة):

```bash
# القيمة 1 — keystore مشفّر base64 (يُستخدم في السري ANDROID_KEYSTORE_BASE64)
base64 -w0 /etc/dzhoot/android-signing/dzhoof-production.jks

# القيم 2-4 — اقرأها من signing.env
cat /etc/dzhoot/android-signing/signing.env
```

| السري/المتغير | القيمة |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` (secret) | مخرجات `base64 -w0` أعلاه |
| `SIGNING_STORE_PASSWORD` (secret) | من `signing.env` |
| `SIGNING_KEY_ALIAS` (secret) | من `signing.env` |
| `SIGNING_KEY_PASSWORD` (secret) | من `signing.env` |
| `DZHOOF_API_URL` (secret أو variable) | `https://iptv.ld-11.net/` |

## 2. إضافة الأسرار في GitHub

GitHub → الريبو → **Settings → Secrets and variables → Actions** → أضف الأربعة كـ *Repository secrets* و`DZHOOF_API_URL` (secret أو variable — الـ workflow يقبل الاثنين).

أو عبر `gh` من جهازك:

```bash
gh secret set ANDROID_KEYSTORE_BASE64 < value.txt
gh secret set SIGNING_STORE_PASSWORD
gh secret set SIGNING_KEY_ALIAS
gh secret set SIGNING_KEY_PASSWORD
gh secret set DZHOOF_API_URL --body "https://iptv.ld-11.net/"
```

## 3. تشغيل الإصدار

**خيار أ — إصدار نهائي (tag):** أنشئ tag وادفعه:

```bash
git tag v1.0.7
git push origin v1.0.7
```

`android/.github/workflows/release.yml` سيبني APK موقّعًا ويحمّله كـ GitHub Release artifact (اسم الملف يبدأ بـ `dzhoof-`).

**خيار ب — إصدار مرشح (manual):** من تبويب Actions → **Release Candidate** → أدخل `version_name` (مثال `1.0.7-rc.1`) و`api_url` (`https://iptv.ld-11.net/`) → Run workflow. الناتج APK موقّع في Artifacts.

## 4. التحقق بعد البناء

1. الـ build نجح والـ artifact موجود (`android/app/build/outputs/apk/release/*.apk`).
2. الـ APK موقّع: `apksigner verify --print-certs <apk>` يعرض شهادة التوقيع (شغّلها محليًا أو في CI).
3. ثبّت الـ APK على جهاز/محاكي واختبر: تسجيل الدخول، الاقتران PIN/QR، تشغيل قناة، EPG، المفضلة.
4. لا ترفع الـ APK يدويًا إلى Git أبدًا — استخدم GitHub Releases/Artifacts.

## ملاحظات أمنية

- `signing.env` والـ keystore موجودان فقط على الخادم بصلاحيات `600`، ومستثنيان من النسخ الاحتياطي غير المشفر.
- لا تشارك كلمات المرور في قنوات غير آمنة؛ إذا سُرّبت يومًا، ولّد keystore جديدًا فورًا (تغيير المفتاح يكسر تحديثات التطبيقات الموقعة سابقًا — خطط لذلك).
