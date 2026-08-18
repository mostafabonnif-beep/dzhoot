# بوابة الإصدار — Golden E2E

هذه البوابة تغطي المسار الأمني الحرج قبل اعتبار النسخة Release Candidate:

1. إنشاء مستخدم وتسجيل الدخول.
2. تفعيل اشتراك وخطة تحتوي على Entitlements.
3. إنشاء جهاز وإصدار Device Credential عشوائي.
4. إصدار Playback Token عبر `X-Device-Token`.
5. التأكد من أن الـPlayback URL لا يكشف الـupstream URL.
6. إبطال الجهاز.
7. التأكد من أن Playback Token القديم يفشل مباشرةً بـ401.
8. انتهاء الاشتراك.
9. التأكد من رفض إصدار Playback جديد بـ`SUBSCRIPTION_EXPIRED`.

## التشغيل

```bash
cd server
npm ci
npm run smoke:golden-e2e --workspace=@dzhoof/backend
```

أو:

```bash
cd server/backend
npm run smoke:golden-e2e
```

## ملاحظة

الاختبار يستخدم `MongoMemoryServer` ولا يتصل بمصدر IPTV حقيقي. هدفه إثبات المصادقة، الاشتراك، Entitlement، Device Credential، وإبطال Playback Token. فشل الاتصال بالـupstream التجريبي لا يُعتبر فشل مصادقة.

## Release Gate

لا يُنصح بإصدار Production إذا فشل أي من:

- typecheck
- lint
- backend tests
- frontend tests/build
- Android lint/unit tests
- Golden E2E
- Docker Compose validation
- dependency audit بمستوى high أو أعلى
