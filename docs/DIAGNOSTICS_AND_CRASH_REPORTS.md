# التشخيصات وتقارير الأعطال — DZ HOOF

> هذا الملف يوثّق ما يخرج من الجهاز عند حدوث خطأ، وما يجب أن **لا** يخرج منه أبداً.
> يخصّ `app/src/main/java/com/dzhoof/iptv/crash/` و`.../update/diagnostics/` على
> أندرويد، و`server/backend/src/routes/app-update.js` (`POST /api/v1/app/crash-report`)
> و`server/backend/src/services/audit-log.ts` (`redactSensitiveText`) على الخادم.

## 1) لماذا طبقتان للتنقيح؟

تقرير العطل يُكتب على القرص داخل الجهاز ثم يُرفع في التشغيل التالي، وقد يكون الجهاز
قديماً أو التطبيق قد تعطّل قبل أن ينظّف نفسه. لذلك:

1. **على الجهاز** (`CrashRedactor`) — يُنقّح `exceptionMessage` و`stackTrace` قبل
   الكتابة في الطابور، وقبل أي تسجيل في logcat (لا يُسجَّل النص الخام إطلاقاً).
2. **على الخادم** (`redactSensitiveText`) — يُنقّح مرة ثانية عند الاستلام، قبل التخزين.

لا يُعتمد على الطبقة الأولى وحدها: التطبيق المنشور قد يكون نسخة أقدم بلا قواعد جديدة.

## 2) القواعد الإلزامية (متطابقة بين الطبقتين)

| الصنف | مثال | الناتج |
|---|---|---|
| بيانات اعتماد في URL (أي بروتوكول) | `https://user:pass@host/x`، `rtsp://user:pass@host/x` | `https://[redacted]@host/x` |
| حساب Xtream في المسار | `/live/<user>/<pass>/1423.ts` | `/live/[redacted]/[redacted]/` |
| معاملات سرية | `?username=&password=&token=&sessionid=` | `?username=[redacted]&…` |
| إسناد سرّي (بما فيه JSON ومفاتيح بين علامتي تنصيص) | `password=…`، `{"password":"…"}`، `"token":"…"` | `{"password":"[redacted]"}` |
| ترويسة تفويض (كاملة) | `Authorization: Basic dXNlcjpwYXNz` | `Authorization: [redacted]` |
| مخطط تفويض بلا ترويسة | `Basic dXNlcjpwYXNz` | `Basic [redacted]` |
| رمز Bearer / JWT | `Bearer eyJ…` | `Bearer [redacted]` / `[redacted-jwt]` |
| كوكي (ترويسة أو إسناد) | `Cookie: session=…`، `sessionid=abc` | `Cookie: [redacted]` |
| عنوان IPv4 خام | `185.199.108.153` | `[redacted-ip]` |
| عنوان IPv6 خام | `2001:db8::1`، `[2001:db8::1]`، `::1` | `[redacted-ip]` |

**IPv6 مُغطّى الآن** (كان الفجوة الموثّقة سابقًا). القاعدة تطابق ثلاث صور: المضغوطة
(تشترط `::` حرفيًّا)، والصيغة الكاملة بثماني مجموعات، والصورة المضمّنة بين قوسين كما تظهر
في الـURL. اشتراط `::` مقصود: بدونه تُطابق سلسلة وقت مثل `12:34:56` وتُتلف نصًّا مفيدًا.
القاعدتان متطابقتان في `CrashRedactor` (كوتلين) و`redactSensitiveText` (الخادم)، ومؤكَّدتان
بجدول اختبارات واحد في `CrashRedactorTest` و`audit-log.test.ts`.

ملاحظة عن العناوين: قاعدة IPv4 تعني أن سلسلة إصدار من أربعة أرقام (`1.2.3.4`) داخل نص
عطل ستُستبدل أيضاً. هذا مقبول: الخصوصية أولى، ونصّ الفشل (النوع، الرسالة، `file:line`)
يبقى كافياً لتتبّع العلّة.

## 3) ما يجب أن يبقى (فائدة التقرير)

- `exceptionType`، وموضع الفشل `file:line`، ونوع الخيط، والشاشة، وإصدار التطبيق
  (`appVersion`/`appVersionCode`)، والمنصة، والطراز، وإصدار أندرويد.
- حقول التصنيف (P1-1): `errorCode`، `correlationId`، `feature`، `retryable`، `severity`.
  - `correlationId` يأتي من العميل، وإن غاب يُستخدم معرّف طلب الـAPI نفسه، فلا يبقى
    تقرير بلا رابط.
  - `severity` تُقبل فقط من `critical|error|warning|info`، و`retryable` من `true|false`؛
    أي قيمة أخرى تُخزَّن `null` بدل نص حر.

## 4) كيف تُختبر هذه الضمانات

```bash
# الخادم: اختبار نهاية-إلى-نهاية يرفع تقريراً ملوّثاً بكل الأصناف ويقرأ المخزَّن
cd server/backend && npx jest src/__tests__/app-update-crash-report.test.ts

# قواعد التنقيح نفسها
cd server/backend && npx jest src/services/audit-log.test.ts

# أندرويد: قواعد الجهاز (بما فيها الكوكي والعنوان الخام)
cd android && ./gradlew :app:testStagingDebugUnitTest -PversionName=1.3.1 -PdzhoofApiUrl=https://iptv.ld-11.net/
```

اختبار الخادم `stores nothing that the operations brief forbids` يمرّ على **كل** الحقول
النصية للمستند المخزَّن (وليس الحقول المتوقعة فقط) ويفشل إن نجا أي صنف من الأصناف
المذكورة أعلاه — وهو ما كشف ثغرتَي الكوكي والعنوان الخام في 2026-09-15.

## 5) أين تظهر التقارير للمشغّل

- `GET /api/v1/admin/diagnostics` — لوحة التشخيصات (بيانات النظام والإصدار).
- لوحة الإدارة: صفحة التشخيصات و`GET /api/v1/app/version` لمعرفة الإصدار المنشور.
- `/health?details=true` — تشمل `notifications.channels` وحالة كل قناة تنبيه
  (`ok` / `not_configured` / `missing_credentials` / `dev_sink`) بلا أي قيمة سرية.
