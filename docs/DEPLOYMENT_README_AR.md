# DZ HOOF IPTV — الحزمة الكاملة (17 أغسطس 2026)

هذه الحزمة تحتوي **المشروع كاملًا** بعد جلسة فحص وإصلاح شاملة: الكود المصدري (Backend + Frontend + تطبيق Android) + كل الإصلاحات المطبقة + التطبيق الجاهز (APK v2.1) + أكواد التفعيل + الوثائق.

---

## 📦 محتويات الحزمة

```
DZHOOF-COMPLETE-2026-08-17/
├── dzhoot/                        # الكود المصدري الكامل (بكل الإصلاحات)
│   ├── server/                    #   Backend (Express/Mongo/Redis) + لوحة الإدارة (Next.js)
│   ├── android/                   #   تطبيق Android/Android TV (Kotlin/Compose)
│   ├── scripts/                   #   أدوات التشخيص (source-validator.js...)
│   └── docs/                      #   وثائق المشروع
├── release/                       # التطبيق الجاهز للتوزيع
│   ├── DZHOOF-IPTV-v2.1.apk       #   APK موقّع (75MB)
│   ├── dzhoof-release.keystore    #   مفتاح التوقيع (احفظه بأمان!)
│   ├── signing.env.example        #   إعدادات التوقيع
│   └── APK-SHA256.txt
├── docs/                          # تقارير الفحص والحلول (عربي)
├── ACTIVATION_CODES.txt           # أكواد تفعيل الزبائن
└── DEPLOYMENT_README_AR.md        # هذا الملف
```

---

## 🛠️ الإصلاحات المطبقة في هذه النسخة (مهمة!)

| # | الإصلاح | الملف |
|---|---|---|
| 1 | **عنوان الخادم أصبح ديناميكيًا** — يتغير من إعدادات التطبيق بدون إعادة بناء APK (حل مشكلة 530 المتكررة نهائيًا) | `android/.../di/NetworkModule.kt` |
| 2 | استيراد كتالوج Xtream من IP محجوب (وضع `import-catalog`) | `server/backend/src/routes/admin-xtream-sources.js` + `services/xtream-service.ts` |
| 3 | حقل `stream_icon`/`backdrop_path` كمصفوفة يكسر الاستيراد | `services/xtream-service.ts` |
| 4 | قناة برابط rtmp:// تكسر قائمة الزبون كلها (500) | `routes/tv.js` |
| 5 | استيراد M3U كبير يتجمد (Promise.all غير محدود) | `routes/admin.js` |
| 6 | EPG يفشل مع إعادة التوجيه 302 | `services/epg-service.ts` |
| 7 | إظهار المصدر للزبائن بقرار صريح (`customerVisible`) | `routes/tv.js` + `models/XtreamSource.ts` |
| 8 | كاش بناء قديم يكسر `npm run build` | `.gitignore` (`*.tsbuildinfo`) |
| 9 | مسار تنزيل عام للـ APK (`PUBLIC_DOWNLOADS_DIR`) | `server/backend/src/server.js` |
| 10 | أدوات فحص المصادر `source-validator.js` | `scripts/stream-diagnostics/` |

---

## 🚀 التشغيل (على خادمك الخاص)

### المتطلبات: Node 20+، MongoDB 7/8، Redis (اختياري)

```bash
cd dzhoot/server
cp .env.example .env            # ثم املأ الأسرار (JWT، Mongo URI...)
npm ci                          # تثبيت الاعتماديات (~3 دقائق)
npm run build                   # بناء shared + backend + frontend

# تشغيل MongoDB و Redis محليًا أو عبر Docker:
# docker compose -f docker-compose.yml up -d mongodb redis

# تشغيل الخادم:
npm run start -w @dzhoof/backend          # المنفذ 3000 (أو PORT=8009)
# تشغيل اللوحة:
cd frontend && NEXT_PUBLIC_API_URL=http://127.0.0.1:3000 npx next start -p 3001
```

> **ملاحظات بناء مهمة** (من جلسة الفحص):
> - `npm ci` من مجلد `server/` (هو جذر الـ workspace)
> - إذا فشل `npm run build -w @dzhoof/backend` بخطأ templates → احذف `backend/tsconfig.tsbuildinfo`
> - الواجهة: استخدم `next build` مع `NEXT_PUBLIC_API_URL` وقت البناء (الـ rewrites تُثبَّت وقت البناء)

### تشغيل على VPS (الإنتاج)
اتبع `dzhoot/server/docs/VPS_DEPLOYMENT_RUNBOOK.md` — أو الأبسط: `docker compose -f docker-compose.production.yml up -d` مع إعداد Caddy والنطاق.

---

## 📲 التطبيق (APK v2.1)

- **موقّع** بشهادة DZ HOOF (نفس المفتاح في `release/dzhoof-release.keystore`)
- **يشتغل فورًا** بالخادم الحالي، و**يسمح بتغيير عنوان الخادم من الإعدادات** (إعدادات → إضافة مصدر/اقتران → عنوان الخادم) — إذا تغيّر عنوان الخادم مستقبلًا، غيّره في التطبيق بدل إعادة البناء

### أكواد التفعيل (كل كود = سنة كاملة + جهازان):
انظر `ACTIVATION_CODES.txt`

---

## 🔑 مفاتيح وأسرار

- `release/dzhoof-release.keystore` + `signing.env.example` — مفتاح توقيع التطبيق. **احتفظ به في مكان آمن**: بدونه لا يمكن تحديث التطبيق عند الزبائن.
- `server/.env` غير مرفق (يُبنى من `.env.example`) — لا ترفع أسرارك إلى GitHub أبدًا.

---

## ⚠️ الوضع الحالي (بصراحة)

- **الخادم التجريبي الحالي**: اللوحة والتطبيق مربوطان بنفق مؤقت — الروابط الحالية في الرسالة المرافقة (تتغير عند إعادة تشغيل بيئة الفحص)
- **قنوات iptv-org (~12,700)**: تعمل الآن مباشرة
- **قنوات World Upstream (16,609)**: مستوردة ومرئية للزبائن، لكن بثّها يحتاج خادمًا بعنوان IP غير محجوب (VPS) — عندها تعمل تلقائيًا
- **الاختبارات**: 200/200 خضراء

---

*أُعدّت بواسطة جلسة الفحص الشامل 17-08-2026. للأسئلة: راجع التقارير في مجلد `docs/`.*
