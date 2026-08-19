# إعادة بناء بيئة العرض التجريبية (Demo) من الصفر

هذا الدليل يشرح كيف تستعيد نفس إعدادات التجربة (قنوات Business Cloud NEO + iptv-org) على بيئة جديدة — ساندبوكس جديد، حساب MoClaw آخر، أو الـ VPS — **دون إعادة العمل يدويًا**.

## مبدأ الفصل

| النوع | أين يُحفظ | مثال |
|---|---|---|
| الكود والسكربتات | GitHub (`oussama` repo) | `scripts/setup-demo-sources.mjs` |
| الأسرار (بيانات الدخول، مفاتيح Xtream) | `.env` محلي / GitHub Secrets | لا تُرفع أبدًا إلى GitHub |
| البيانات (القنوات المستوردة) | MongoDB — تُنقل بـ mongodump أو تُعاد استيرادها بالسكربت | نسخة احتياطية محلية |

## الطريقة 1 — السكربت التلقائي (موصى بها)

1. انسخ المستودع وثبّت الاعتماديات:
   ```bash
   git clone https://github.com/mostafabonnif-beep/oussama.git
   cd oussama/server && npm ci
   ```
2. أنشئ `server/.env` من `.env.example` (مفاتيح JWT عشوائية + حساب مشرف قوي).
3. أضف بيانات مصدر NEO إلى `.env`:
   ```bash
   export ADMIN_USERNAME=admin
   export ADMIN_PASSWORD=...
   export NEO_XTREAM_URL=https://cf.business-cloud-neo.ru
   export NEO_XTREAM_USERNAME=...
   export NEO_XTREAM_PASSWORD=...
   export IPTV_ORG_M3U_URL=https://iptv-org.github.io/iptv/countries/dz.m3u
   ```
4. شغّل السكربت:
   ```bash
   node scripts/setup-demo-sources.mjs
   ```
5. النتيجة: مصادر Xtream + M3U مُنشأة، الاستيراد يبدأ تلقائيًا (القنوات الحية تظهر تدريجيًا).

> ملاحظة: استيراد كتالوج NEO الكامل (16,609 قناة + أفلام + مسلسلات) يستغرق وقتًا. مرحلة حلقات المسلسلات بطيئة (16,710 مسلسل بتوازي 3) — جعلها lazy يُنصح بها كتحسين قادم.

## الطريقة 2 — استعادة نسخة احتياطية (mongodump)

أسرع طريقة لاستعادة **كل القنوات كما هي** دون إعادة جلبها من البانل:

1. شغّل MongoDB محليًا أو على الـ VPS.
2. استعد من الأرشيف الذي استلمته من الجلسة:
   ```bash
   tar -xzf dzhoof-db-backup-*.tar.gz
   mongorestore --drop --db dzhoof-iptv dump/dzhoof-iptv
   ```
3. **مهم**: بيانات اعتماد المصادر مخزّنة مشفرة بمفتاح `XTREAM_SECRET_KEY` — استخدم نفس المفتاح من ملف الأسرار المرفق مع الأرشيف، وإلا فشل فك التشفير. أعد إدخال بيانات اعتماد NEO يدويًا من لوحة الإدارة إن لزم.

## التحقق بعد الإعداد

- اللوحة → "قنواتي" → يجب أن ترى 16,609+ قناة.
- اللوحة → "مصادر Xtream" → المصدر بحالة `degraded` (API يعمل، بث محجوب من IP الخادم الحالي) — على الـ VPS غير المحجوب يصبح `verified` تلقائيًا بعد `test`.
- قنوات iptv-org (مثل AL24 News) تعمل فورًا عبر مشغّل المعاينة في اللوحة.
