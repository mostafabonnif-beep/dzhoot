# دليل إعداد التنبيهات — DZ HOOF

هذا الدليل يغطي البند P1 من `RELEASE_RISK_REGISTER_AR.md`: "لا يوجد alerting خارجي كامل لفشل المزامنة والنسخ". الآلية البرمجية جاهزة (`ALERT_WEBHOOK_URL` مستعملة في `backup.sh`، `restore-drill.sh`، وworkflow `restore-drill.yml`)؛ الناقص هو ربطها فعليًا بقناة مراقبة يملكها المشغل.

## 1. اختيار القناة

أبسط خيار هو **Slack Incoming Webhook** أو **Discord Webhook** — كلاهما يقبل POST بصيغة JSON مباشرة، وهذا يطابق شكل الحمولة (payload) المُرسلة حاليًا من السكريبتات:

```json
{"event":"backup:failure","severity":"critical","message":"...","service":"dzhoof-backup"}
```

### Slack
1. أنشئ Slack App من https://api.slack.com/apps → **Incoming Webhooks** → فعّلها.
2. اختر القناة (مثلاً `#dzhoof-alerts`) واحصل على رابط الـwebhook (`https://hooks.slack.com/services/...`).
3. Slack يتوقع مفتاح `text` وليس `message`؛ الحل الأبسط بدون تعديل السكريبتات هو استعمال خدمة وسيطة صغيرة (انظر القسم 3) أو تعديل بسيط بإضافة `text` مطابق لـ`message` عند الإرسال.

### Discord
1. إعدادات القناة → Integrations → Webhooks → New Webhook → انسخ الرابط.
2. Discord يتوقع `content` وليس `message`، نفس الملاحظة أعلاه.

### الأبسط عمليًا: healthchecks.io أو Betterstack (Uptime)
هذه الخدمات تقبل أي JSON POST كـ"heartbeat فشل" وتتكامل تلقائيًا مع Slack/Email/SMS/PagerDuty من لوحتها، بدون تعديل صيغة الحمولة في الكود. أنسب حل إذا ما تحبش تلمس الكود الآن.

## 2. تفعيلها في البيئات

أضف المتغير في:
- `server/.env` (production) — `ALERT_WEBHOOK_URL=https://hooks.slack.com/services/XXX`
- GitHub Actions secret باسم `ALERT_WEBHOOK_URL` (مستعمل الآن في `.github/workflows/restore-drill.yml`، ويمكن إضافته أيضًا في `ci.yml` لتنبيه فشل الـCI نفسه).
- أي cron يشغّل `backup.sh` على السيرفر (تأكد أن متغيرات البيئة تنتقل للـcron، مثال أسفل).

## 3. Wrapper بسيط لتحويل الصيغة (اختياري، لـSlack/Discord)

إذا حبيت تبقى الحمولة الحالية بلا تعديل بصح توديها لـSlack، أضف سكريبت وسيط:

```bash
#!/usr/bin/env bash
# scripts/alert-relay.sh — يقرأ من stdin (الصيغة الحالية) ويعيد الإرسال لـSlack بصيغة Slack.
MESSAGE=$(cat | python3 -c "import json,sys; print(json.load(sys.stdin).get('message','DZ HOOF alert'))")
curl -sf -X POST -H 'Content-Type: application/json' \
  --data "{\"text\":\"🚨 $MESSAGE\"}" "$SLACK_WEBHOOK_URL"
```

## 4. تشغيل دوري (cron) على السيرفر — مثال

```cron
# نسخ احتياطي يومي 02:00، وتنبيه فوري عند الفشل عبر ALERT_WEBHOOK_URL
0 2 * * *  MONGODB_URI="mongodb://..." ALERT_WEBHOOK_URL="https://hooks.slack.com/..." /opt/dzhoof/server/scripts/backup.sh >> /var/log/dzhoof-backup.log 2>&1
```

## 5. اختبار الإعداد (لازم قبل الاعتماد عليه)

```bash
ALERT_WEBHOOK_URL="https://hooks.slack.com/services/XXX" \
MONGODB_URI="mongodb://invalid-host-on-purpose/db" \
./scripts/backup.sh
```
هذا لازم يفشل عمدًا (host غير صحيح) وتشوف رسالة التنبيه توصل فعليًا للقناة. إذا وصلت → الإعداد سليم.

## 6. الحد الأدنى قبل اعتبار هذا البند "منجز"

- [ ] رابط webhook حقيقي مضبوط في production `.env`.
- [ ] نفس الرابط مضبوط كـ GitHub secret `ALERT_WEBHOOK_URL`.
- [ ] اختبار فشل متعمد (القسم 5) نجح فعليًا في الوصول للقناة.
- [ ] شخص مسؤول متابع للقناة فعليًا (مو webhook معلق بلا مراقبة).
