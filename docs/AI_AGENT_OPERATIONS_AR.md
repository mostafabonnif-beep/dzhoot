# دليل عمليات وكيل الذكاء الاصطناعي — DZ HOOF

> **لمن هذا الملف؟** أي وكيل AI (MoClaw، Claude Code، Copilot Agent) مكلّف بإكمال تطوير المشروع من البداية إلى النشر. `AGENTS.md` الجذري يضبط **قواعد الكود**؛ هذا الملف يضبط **التشغيل**: من يملك ماذا، وكيف تتحقق، وكيف تصدر، وما يجب أن ينتظر موافقة الإنسان.
>
> لا أسرار هنا. القيم الحسّاسة محلها مسجّل، وقيمها لا تُكتب أبداً في المستودع أو السجلات.

## 1) البيئات والوصول

| المورد | الموقع | ملاحظات |
|---|---|---|
| المستودع | `github.com/mostafabonnif-beep/dzhoot` | Android في `android/`، الخادم في `server/`، CI في `.github/` |
| خادم الإنتاج (VPS) | `5.135.79.221` | البنية: 6 حاويات Docker (`dzhoof-api/frontend/scheduler/caddy/redis/mongodb`)، API على `https://iptv.ld-11.net` |
| مضيف البناء | على نفس الـVPS | تُبنى الحزم في مجلدات خربشة كمستخدم `dzhoof-admin` (مثال `/tmp/<tag>/repo`) |
| توقيع Android | `SIGNING_*` في إعدادات GitHub، وعلى الـVPS | الوركفلو يتحقق من وجودها قبل البناء |

- **مستخدمو الوصول للوكيل**: مفتاح SSH للـGitHub والـVPS يُسلَّم للوكيل خارج المستودع (محلياً عند MoClaw: `projects/dzhoot/keys/` و`projects/dzhoot/access.md` محمي بـ600). لا تضعهما أبداً في git.
- **نسخة العمل المحلية قد تكون sparse-checkout** (`android` + `.github` فقط) — فتأكد من النطاق قبل استنتاج أن ملفاً غير موجود. الخادم `server/` موجود في المستودع رغم أن نسخة كهذه لا تُظهره.

## 2) التحقق المحلي (لا تكتفِ بالتصريف)

الدرس المسجّل (`ci-requires-unit-tests`): **`compileOfficialReleaseKotlin` لا يترجم مصادر الاختبار ولا يشغّلها**. قبل الدفع، شغّل **نفس أمر CI** على مضيف البناء:

```bash
cd <repo>/android
./gradlew :app:compileOfficialReleaseKotlin :app:testStagingDebugUnitTest \
  --no-daemon -PversionName=<X.Y.Z> -PdzhoofApiUrl=https://iptv.ld-11.net/
# ثم تأكد: app/build/test-results/testStagingDebugUnitTest/*.xml بلا <failure>/<error> (64 ملفاً، 0 فشل = أخضر)
```

- عند تغيير واجهة Repository أو ViewModel constructor، حدّث الـfakes في `app/src/test` **في نفس الالتزام**.
- **فخ التصدير الجزئي** (`partial-source-overlay`): عند التحقق على مضيف بعيد، صدّر `app/src` **كاملاً** من الفرع الحالي؛ تصدير شجرة جزئية من checkout قديم يخلط مراجعتين ويُظهر أخطاء وهمية «overrides nothing».

## 3) إصدار أندرويد (الوسم هو المصدر الوحيد للإصدار)

`versionCode` مشتق: `major*10000 + minor*100 + patch` (مثال 1.2.4 → 10204). لا تُعدّل كوميت إصدار.

1. دمج الـPRs بعد خضرة CI (`DZ HOOF CI` + `CodeQL`).
2. وسم على `main`: `git tag vX.Y.Z origin/main && git push origin refs/tags/vX.Y.Z` — هذا يُشغّل **Android Release** ويبني APK موقّعاً ويرفع الأصلين.
3. تحقّق بعد البناء:
   - الأصول: `dzhoof-tv-vX.Y.Z-official.apk` + `.sha256` (اسم موحّد منذ PR #234).
   - `apksigner verify` + `aapt dump badging`: `versionName=X.Y.Z`، `versionCode` المشتق، `com.dzhoof.iptv`، وشهادة الإنتاج.
   - نقطة التحديث: `GET https://iptv.ld-11.net/api/v1/app/version?currentVersion=<code>` ترجع `latestVersion.versionName=X.Y.Z` و`updateAvailable=true`.
   - امسح كاش Redis مفتاح `ghrel:latest` بعد أي تغيير في أصول الإصدار (الريديس يحتاج AUTH من متغيّر الحاوية؛ **لا تطبع القيمة**).

## 4) اتفاقيات المنتج

- **العربية أولاً وRTL صحيح** لكل نص مرئي؛ النص الإنجليزي الوحيد المقصود هو «DZ HOOF».
- **التصميم**: ذهبي = لون التركيز، زمردي/أخضر = المختار/الإجراء (قاعدة التوكنين). هوية جزائرية، لا نسخ من تطبيقات أخرى (راجع `AGENTS.md`).
- نمط الدمج: فرع → PR → انتظار CI أخضر → دمج (`merge_method=merge`). **لا دمج مع CI أحمر.**
- سجل الإصدارات: تحقّق من `https://iptv.ld-11.net/` (بوابة المشترك) قبل تشفير رابطها في QR.

## 5) المحاذير (تُنتهك كثيراً — اقرأها مرتين)

1. **الإنتاج يُنشر نشراً ذرّياً** من `/opt/dzhoot-releases/<sha>`؛ أي تعديل مباشر على كود الإنتاج **يُمسح** عند النشر التالي. عدّل في المستودع، ثم انشر رسمياً.
2. **تغييرات خادم الإنتاج (نشر `server/`) تحتاج موافقة الإنسان** — لا تنشر بلا إذن صريح.
3. **لا تطبع أسراراً**: كلمات المرور، التوكنات، مفاتيح التوقيع. خزّنها مؤقتاً بـ600 واحذفها بعد الاستعمال.
4. لا تدمج PR مع CI أحمر، ولا تتخطَّ الاختبارات لأن «التصريف نجح».
5. لا تعِد بناء سطح تنقّل موجود: `SideNavRail` موصول في `ComposeMainActivity` (الوضع الأفقي).

## 6) ما ينتظر الإنسان (لا يمكن للوكيل إنجازه ذاتياً)

- **FCM/الإشعارات**: يحتاج `google-services.json` من لوحة Firebase ثم إضافته كسرّ GitHub.
- **فرز الكتالوج الخلفي** (أبجدي/سنة/تقييم): معامل `sort` صغير في `server/backend/src/routes/catalog.js` + نشر — يحتاج موافقة نشر.
- مراجعة PR Dependabot لتحديث `softprops/action-gh-release` (أُجّل لما بعد v1.2.4).

## 7) مرجع سريع للملفات المؤثرة

- التصميم: `android/app/src/main/java/com/dzhoof/iptv/presentation/ui/theme/*`
- البوابة/الرئيسية: `.../ui/screens/home/*`، التنقّل: `ComposeMainActivity.kt` + `navigation/`
- فئات الكتالوج: `.../viewmodel/CatalogViewModel.kt` + `data/repository/CatalogRepositoryImpl.kt`
- الاشتراك/الجهاز: `.../viewmodel/SubscriptionViewModel.kt` + `ui/screens/settings/SubscriptionSection.kt`
- الإصدار: `.github/workflows/android-release.yml` + `android/app/build.gradle.kts`
