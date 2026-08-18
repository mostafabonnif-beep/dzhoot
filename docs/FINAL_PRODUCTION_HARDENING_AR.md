# DZ HOOF — Final Production Hardening Batch

تم تنفيذ دفعة موحدة من تحسينات الأمان والاعتمادية مع الحفاظ على التوافق مع `channelListCode` أثناء فترة الانتقال.

## 1. Device Credential

- تم إضافة credential عشوائي 32-byte للجهاز يبدأ بـ `dzdev1.`.
- يتم تخزين SHA-256 فقط في MongoDB.
- credential له صلاحية افتراضية 180 يومًا ويمكن تدويره.
- تمت إضافة `X-Device-Token` إلى Android network layer.
- يبقى `X-TV-Code` متاحًا للتوافق مع الإصدارات القديمة.
- credential الذي ينتج من pairing يتم تسليمه مرة واحدة فقط، ويُخزّن مؤقتًا مشفرًا داخل `PairingRequest`.

## 2. Playback security

- `playbackCredentialVersion` يبطل التوكنات القديمة فور revoke/regenerate.
- `PLAYBACK_TOKEN_SECRET` إلزامي في production.
- token قصير العمر ولا يعتمد على أسرار JWT/Xtream.

## 3. Subscription

- production fail-closed عند غياب إعداد subscription gate.
- Redis وMongo مطلوبان في self-host stack.

## 4. Backups

- `server/scripts/backup/mongo-backup.sh`
- `server/scripts/backup/mongo-restore.sh`

يجب تخزين النسخ خارج نفس الـhost واختبار restore دوريًا.

## 5. Migration

بعد النشر الأول:

```bash
npm run migrate:playback-credential-version
npm run migrate:device-credentials
```

## 6. Verification required before release

شغّل في CI متصل بالإنترنت:

```bash
cd server
npm ci
npm run typecheck
npm run lint
npm run build:backend
npm run test:backend
```

ثم Android:

```bash
cd android
./gradlew lintDebug testDebugUnitTest assembleDebug
```

ولا يتم اعتبار الإصدار Production Release قبل نجاح هذه الخطوات ونجاح restore drill حقيقي من backup إنتاجي معزول.
