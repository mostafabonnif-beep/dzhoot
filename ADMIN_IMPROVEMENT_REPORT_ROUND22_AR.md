# تقرير الجولة 22 — الجزء 6: وايت لابل + مفاتيح API للموزعين (2026-09-03)

> الجلسة: Zo Computer — بطلب المستخدم: «لوحة التحكم الأم لا تزال تحتاج الكثير من التحسين والتطوير».
> التنفيذ حسب `WORK_PLAN_ADMIN_PARTS_AR.md` — الجزء 6 (أول جزء كبير قابل للتنفيذ كاملًا عن بُعد؛
> الجزء 8 يحتاج حساب CinetPay، والجزء 5 يحمل ترحيل بيانات لا يُجرى دون تحقق حي على الخادم).

## الحالة: ✅ مكتمل — PR #178 مدموج في `main`، CI أخضر بالكامل، **بانتظار النشر على الخادم**

---

## 1) ما الذي أُضيف

### الهوية البصرية (وايت لابل) لكل موزع

- حقل `branding` جديد على نموذج `Reseller`: `displayName` (≤60) + `logoUrl` (https فقط، ≤500) + `primaryColor` (#rrggbb).
- **صفحة الشراء العامة** `/buy?shop=<id>`: اسم العرض والشعار يظهران للزبون بدل الاسم الخام، مع `primaryColor` كإطار للهوية.
- **بطاقة QR المطبوعة** (`shop-qr-card`): اسم العرض + الشعار + لون الهوية بدل اسم الموزع الداخلي.
- **بوابة الموزع**: قسم جديد «الهوية البصرية ومفاتيح API» — الموزع يعدّل هويته بنفسه (`PUT /reseller/branding`).
- **لوحة الأدمن**: حقول الهوية في نافذة تعديل المحل (`PUT /admin/resellers/:id` يقبل `branding`).

### مفاتيح API للموزعين (للتكامل الخارجي)

- نموذج `ResellerApiKey`: المفتاح يُخزَّن **SHA-256 فقط** (لا نص صريح في القاعدة)، مع prefix للعرض (`dzhk_xxxxxx…`) و`lastUsedAt` وحد **10 مفاتيح** لكل موزع.
- إنشاء من بوابة الموزع (`POST /reseller/api-keys`) أو من لوحة الأدمن (`POST /admin/resellers/:id/api-keys`) — **النص الصريح يُعرض مرة واحدة فقط**.
- مصادقة `X-API-Key` على **قراءات آمنة فقط** (قائمة بيضاء: `me`, `ledger`, `statement`, `clients`, `credit`, `batches`, `batches/:id/codes`, `tickets`, `debts`).
  كل كتابة أو إدارة مفاتيح تبقى JWT فقط — المفتاح المسرّب لا يعدّل شيئًا ولا ينسخ نفسه.
- إلغاء فوري (soft delete) من البوابة أو اللوحة.

## 2) الملفات

| الملف | التغيير |
|---|---|
| `models/Reseller.ts` | `branding` + دالة `safeHttpsUrl` للتحقق من الروابط |
| `models/ResellerApiKey.ts` | جديد — المفاتيح + `createResellerApiKey` |
| `middleware/requireReseller.ts` | `requireResellerOrApiKeyForReads` (JWT كامل، API-key قراءات فقط) |
| `routes/reseller.js` | `PUT /branding` + `GET/POST/DELETE /api-keys` |
| `routes/admin-resellers.js` | `branding` في PUT + `GET/POST /:id/api-keys` + `DELETE /:id/api-keys/:keyId` |
| `routes/public-shop.js` | إرجاع الهوية مع `shop=<id>` |
| `components/reseller/branding-api-keys.tsx` | جديد — قسم البوابة |
| `admin/resellers/page.tsx` | حقول الهوية + حوار مفاتيح API |
| `shop-plans.tsx` / `shop-qr-card.tsx` | عرض الهوية للزبون |
| `locale-provider.tsx` | مفاتيح ar/en/fr جديدة |
| `__tests__/reseller-white-label-apikeys.test.ts` | جديد — 7 اختبارات |

## 3) التحقق

- **492/492** اختبار backend ✅ (كانت 485 + 7 جديدة: تخزين الهاج فقط، القراءات المسموحة، رفض الكتابة بالمفتاح، الإلغاء الفوري، سقف 10، الهوية في `/shop/plans`، إدارة الأدمن).
- `tsc` نظيف على backend وfrontend، `eslint` بلا أخطاء، `next build` ناجح.
- CI على PR #178: backend ✅ / frontend ✅ / CodeQL ✅ / Secret guard ✅.

## 4) ⚠️ خطوة متبقية: النشر على الإنتاج

هذه الجلسة **لا تملك وصول SSH** للخادم (كلمة المرور المرسلة رُفضت — الخادم يقبل المفتاح العام فقط
`Permission denied (publickey)`، ومفتاح `dzhoof-admin-key` القديم في تاريخ المستودع أُبطل — تم تدويره).
النشر يتم من الخادم مباشرة:

```bash
cd /opt/dzhoot && git fetch origin && git checkout 892a9eb..origin/main   # أو آخر sha بعد الدمج
./scripts/deploy/atomic-deploy.sh <SHA>        # dry-run أولاً
APPLY=1 ./scripts/deploy/atomic-deploy.sh <SHA>  # تطبيق فعلي
```

أو أعِد تمكين دخول SSH (كلمة مرور أو مفتاح جديد) وأخبرني — أكمل النشر والتحقق الحي.

## 5) التالي المقترح

1. **الجزء 5** — باقات Live/VOD (يُفضل نافذة صيانة مع وصول تحقق).
2. **الجزء 7** — موزعون فرعيون (يعتمد على الجزء 3 المنجز).
3. **الجزء 8** — CinetPay (يحتاج مفاتيح الحساب منك).
4. من الجولة 11: رفع تغطية MIBOX بال مطابقة الدفعات + فحص صحة مستقل للـ relay (تحتاج وصول SSH).
