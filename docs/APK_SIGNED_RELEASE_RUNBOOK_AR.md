# دليل تشغيل أول Release APK موقّع — DZ HOOF

**ملاحظة مهمة:** بعد المراجعة، تبين أن إعداد التوقيع **موجود ومكتمل بالفعل** في الكود:
- `android/app/build.gradle.kts` يقرأ `SIGNING_KEY_STORE`/`SIGNING_STORE_PASSWORD`/`SIGNING_KEY_ALIAS`/`SIGNING_KEY_PASSWORD` من env.
- `.github/workflows/release.yml` يبني APK موقّع تلقائيًا عند push لأي tag بصيغة `v*`، ويتحقق من وجود كل الأسرار قبل البناء، ويرفض `DZHOOF_API_URL` غير HTTPS.

الناقص الفعلي (كما ذكر `PROJECT_STATUS.md`) هو **التشغيل والتحقق الفعلي**، مو الكود. هذا الدليل يغطي ذلك.

## 1. توليد keystore حقيقي (مرة واحدة، واحفظه بمكان آمن خارج الريبو)

```bash
keytool -genkeypair -v \
  -keystore dzhoof-release.keystore \
  -alias dzhoof \
  -keyalg RSA -keysize 2048 -validity 10000
```
احفظ كلمتي السر (store + key) في مدير أسرار (1Password/Bitwarden)، **ليس** في أي ملف داخل الريبو.

## 2. تحويله لـbase64 وإضافته كـ GitHub Secret

```bash
base64 -w0 dzhoof-release.keystore > keystore.b64
```
GitHub repo → Settings → Secrets and variables → Actions → أضف:

| الاسم | القيمة |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | محتوى `keystore.b64` |
| `SIGNING_STORE_PASSWORD` | كلمة سر الـkeystore |
| `SIGNING_KEY_ALIAS` | `dzhoof` (أو الاسم اللي اخترته) |
| `SIGNING_KEY_PASSWORD` | كلمة سر المفتاح |
| `DZHOOF_API_URL` (كـ Variable وليس Secret) | عنوان HTTPS الحقيقي للسيرفر بعد النشر |

اختياري (لتتبع الأعطال في الإنتاج): `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`.

## 3. تشغيل أول Release

```bash
git tag v1.0.0
git push origin v1.0.0
```
هذا يشغّل `.github/workflows/release.yml` تلقائيًا. تابع الـرن من تبويب Actions.

## 4. التحقق بعد البناء

- [ ] الـworkflow نجح بدون فشل في "Validate release configuration".
- [ ] ملف APK ظهر في GitHub Release باسم `dzhoof-1.0.0.apk`.
- [ ] نزّل الـAPK وثبّته على **جهاز Android TV حقيقي** (مو محاكي فقط) — هذا هو الجزء اللي ما زال غير مجرب حسب `RELEASE_RISK_REGISTER_AR.md`.
- [ ] تأكد التطبيق يتصل بـ`DZHOOF_API_URL` الصحيح (مو `https://dzhoof.example/`).
- [ ] جرب: تسجيل دخول، اقتران عبر PIN/QR، تشغيل قناة، تنقل بـD-pad.

## 5. بعدها

- وثّق نتيجة الاختبار على الجهاز الحقيقي في `docs/` (تقرير جديد أو تحديث `PROJECT_STATUS.md`).
- إذا نجح كل شيء → هذا البند يتحول من "غير مجرب" إلى "منجز" في `RELEASE_RISK_REGISTER_AR.md`.
