# DZ HOOF — Direct Playback Architecture

## الهدف

تمت إضافة وضع **Direct Playback** لتقليل استهلاك الـVPS. في هذا الوضع يبقى DZ HOOF مسؤولًا عن المصادقة والاشتراك والجهاز والقناة، بينما تنتقل بيانات الفيديو مباشرة من مزود المحتوى إلى جهاز العميل.

```text
Client
  │
  ├── Authorization ──► DZ HOOF API
  │                     ├─ Subscription
  │                     ├─ Device
  │                     ├─ Channel
  │                     └─ Provider status
  │
  └── Playback ◄────── 302 Redirect ────── Provider
```

## الحماية

Direct Playback لا يعمل تلقائيًا.

يجب توفر شرطان:

1. `ALLOW_DIRECT_PLAYBACK=true` في بيئة الخادم.
2. تفعيل `directPlayback=true` للمصدر من لوحة الإدارة.

الوضع الافتراضي هو `proxy`.

## تنبيه أمني

في Direct Playback لا يظهر رابط المزود في استجابة `/streams/authorize` الأولية، لكن متصفح/مشغل العميل يتبع HTTP redirect، وبالتالي يمكن للعميل رؤية عنوان التشغيل النهائي. هذا مقصود لأنه شرط تقني لتفريغ نقل الفيديو عن الـVPS.

لذلك لا تستخدم Direct Playback إلا مع مزود يسمح لك تعاقديًا بإعادة توزيع المحتوى وبالوضع الذي تقبله من ناحية كشف عنوان المصدر.

## المصادر

يدعم الإصدار الحالي:

- Xtream: Direct Playback للقنوات والأفلام والحلقات.
- M3U: Direct Playback للقنوات.
- بيانات اعتماد المصادر تبقى مشفرة في قاعدة البيانات.
- لا يتم إرسال بيانات اعتماد Xtream إلى تطبيق DZ HOOF في استجابة التفويض الأولية.

## التشغيل

إذا كان Direct Playback مفعّلًا:

```text
POST /api/v1/streams/authorize
        ↓
deliveryMode = direct
        ↓
GET /api/v1/tv/playback/:token
        ↓
HTTP 302
        ↓
Provider stream
```

إذا لم يكن مفعّلًا:

```text
POST /api/v1/streams/authorize
        ↓
deliveryMode = proxy
        ↓
GET /api/v1/tv/playback/:token
        ↓
DZ HOOF proxy
        ↓
Provider stream
```

## ملاحظة اقتصادية

Direct Playback يقلل Bandwidth وCPU المطلوبين على VPS لأن الفيديو لا يمر عبره. لكنه لا يلغي حدود الاتصال المتزامن التي يفرضها مزود المحتوى؛ عدد المشاهدين المتزامنين يجب أن يكون متوافقًا مع الباقة/العقد الخاص بالمزود.
