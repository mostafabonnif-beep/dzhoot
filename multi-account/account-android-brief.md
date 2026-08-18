# بريف حساب Android (الحساب 4)

**دورك:** تجهيز التطبيق للبيع الفعلي + تحصينه.

## مهامك بالترتيب
1. **APK Release موقّع**: مفتاح إصدار محفوظ بأمان (keystore موجود في `release/`) + تسليم عبر GitHub Releases — لا ترفع الـ keystore أو كلمة مروره إلى GitHub أبدًا.
2. **اختبار أجهزة حقيقية**: Fire TV Stick 4K / Mi Box S / Shield / هاتف — RTL، التركيز بالريموت، Catch-up، Multiview، PiP.
3. **اختبارات Instrumented/Compose** للأجهزة (لا يوجد حاليًا androidTest).
4. **RTSP**: إضافة وحدة `media3-exoplayer-rtsp` أو التعامل عبر البروكسي.
5. **Cert Pinning**: إما تنفيذ متسامح (SPKI backup + نافذة تحديث) أو **قرار ADR موثق** — `PinnedHttpClient.kt` حاليًا لا يثبّت شيئًا.
6. **Play Integrity**: بوابة للتحديثات/التفعيل ضد إعادة التوقيع (وضع غير صارم أولًا).
7. **نقل النصوص**: كل النصوص الصلبة إلى `strings.xml` + `values-ar`.
8. **تقييد cleartext HTTP** بالمجالات المضافة من المستخدم فقط.

## قواعدك
- لا تكسر: TvInputService، الاقتران PIN/QR، مشغّل Media3 مع failover، قفل الأبوي.
- Android و Android TV واجهتان مختلفتان — اختبر كليهما.
- أي بناء لا يعمل؟ اذكر العائق البيئي بدقة (JDK/SDK) — لا تدّعي نجاحًا غير مُتحقق.

## خطوتك الأولى
1. التحقق من إمكانية `assembleDebug` في بيئتك (JDK 17+ و Android SDK).
2. PR صغير أول: إعداد توقيع Release آمن + تحديث `signing.env.example`.
