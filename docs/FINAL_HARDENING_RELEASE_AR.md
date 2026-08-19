# DZ HOOF IPTV — Final Hardening Release

## ما تم تنفيذه

- إبطال فوري لـ Playback Tokens عبر `playbackCredentialVersion` عند revoke/regenerate.
- رفض Playback Tokens القديمة بعد تغيير اعتماد المستخدم.
- جعل `PLAYBACK_TOKEN_SECRET` إلزاميًا في Production ومنع fallback إلى secrets التطوير.
- تمرير `playbackCredentialVersion` عبر TV/session/JWT authorization middleware.
- جعل subscription gate يعمل fail-closed في Production إذا لم تتم تهيئته صراحة.
- منع التخزين المؤقت المشترك لروابط EPG التي تحتوي على credential.
- نقل TV code في Android إلى `SecurePreferences` مع migration من التخزين القديم.
- تنظيف TV code من SharedPreferences بعد migration/تحديث الاعتماد.
- فحص magic bytes لصور profile بعد الرفع بدل الاعتماد على MIME/extension فقط.
- تشديد self-host Compose: الخدمات الداخلية لا تُعرّض Mongo/Redis/API مباشرة، مع healthchecks وsecret variables و`SUBSCRIPTION_REQUIRED=true`.
- إضافة migration `0011-backfill-playback-credential-version`.
- إضافة اختبار لحقل credential version في Playback Token.

## التحقق

- تم فحص JavaScript المعدل بواسطة `node --check`.
- تم التحقق من صحة ملفات Compose YAML.
- تم تشغيل TypeScript compiler، لكنه لم يكتمل لأن dependencies (`node_modules`) غير موجودة في بيئة التسليم.
- تم تشغيل Android Gradle build، لكنه توقف لأن Gradle wrapper احتاج تنزيل Gradle من الإنترنت، والبيئة الحالية لا تملك DNS/Internet access.

## قبل Production

1. تنفيذ `npm ci` داخل `server` ثم `npm run typecheck && npm test && npm run lint`.
2. تنفيذ `./android/gradlew :app:assembleRelease` في بيئة متصلة بالإنترنت أو CI.
3. تشغيل migration 0011 قبل/أثناء نشر الإصدار.
4. التأكد من أن جميع production secrets عشوائية بطول 32+ وأن `SUBSCRIPTION_REQUIRED=true`.
5. استخدام reverse proxy/TLS أمام self-host deployments.
6. تنفيذ restore drill حقيقي من backup إنتاجي، وليس synthetic fixture فقط.
