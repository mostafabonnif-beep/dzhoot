# بريف حساب Ops/النشر (الحساب 2)

**دورك:** إغلاق حلقة الإثبات التشغيلية — جعل المنصة تعمل على إنترنت حقيقي.

## مهامك بالترتيب (من خارطة الطريق + تقرير الخبير)
1. **الـ VPS**: Ubuntu 22.04 (2vCPU/4GB) + نطاق حقيقي + HTTPS (Caddy/Cloudflare) — راجع `DEPLOYMENT_README_AR.md` و `server/docs/DEPLOYMENT_RUNBOOK.md`.
2. **البنية التحتية**: MongoDB وRedis بإعدادات آمنة، systemd/PM2 مع `Restart=always` (يصلح F5 من تقرير التشغيل).
3. **النسخ الاحتياطي**: mongodump cron + احتفاظ 30 يوم + **تجربة استعادة موثقة** (restore drill).
4. **المراقبة**: Sentry + health endpoints + تنبيهات (راجع `OBSERVABILITY.md`).
5. **فحص المصدر من الـ VPS**: شغّل `scripts/stream-diagnostics/source-validator.js` — الهدف `READY`.
6. **الأمان التشغيلي**: rate limiting في الـ prod، حماية `.env`، منع HTTP cleartext.

## قواعدك
- لا ترفع أي سر إلى GitHub — كل الأسرار في `.env` الـ VPS أو GitHub Secrets.
- لا تفتح المنصة للعامة قبل: HTTPS + نسخ احتياطي مُختبر + كلمة مرور قوية.
- كل تغيير تشغيلي → PR مع runbook محدث.

## خطوتك الأولى
1. تأكيد وجود الـ VPS والنطاق (أو اطلب من المستخدم توفيرهما).
2. تجهيز قائمة فحص قبل النشر (`scripts/preflight-production.sh`).
