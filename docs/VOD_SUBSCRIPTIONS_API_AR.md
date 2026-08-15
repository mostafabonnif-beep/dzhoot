# VOD وSeries والاشتراكات — تحديث API وسلوك التطبيق

## نطاق التحديث

أضيفت في هذه الجولة تحسينات تحمي مسارات VOD وSeries وتوضح صلاحيات الاشتراك للمستخدم. لا يعرض أي endpoint رابط `streamUrl` الخام، ويظل التشغيل عبر `/api/v1/streams/authorize` ثم playback token قصير العمر ومشفر.

## VOD وSeries

تستمر المسارات التالية كعقود عامة متوافقة مع الإصدار الحالي:

| المسار | السلوك |
|---|---|
| `GET /api/v1/catalog/movies` | قائمة أفلام فعالة فقط، مع pagination وsearch وcategory، ودون `streamUrl`. |
| `GET /api/v1/catalog/movies/:id` | تفاصيل فيلم فعال فقط، ودون `streamUrl`. |
| `GET /api/v1/catalog/series` | قائمة مسلسلات فعالة فقط، مع pagination وsearch وcategory، ودون روابط تشغيل. |
| `GET /api/v1/catalog/series/:id` | تفاصيل مسلسل فعال فقط. |
| `GET /api/v1/catalog/series/:id/seasons` | مواسم Series فعال فقط. |
| `GET /api/v1/catalog/seasons/:id/episodes` | حلقات الموسم بعد التحقق من وجود الموسم وأن Series الأب فعال وأن `seriesId` يطابق الموسم، ودون `streamUrl`. |

كما تم تطبيق parent/source validation في `POST /api/v1/streams/authorize`: الفيلم يتطلب مصدر Xtream فعالًا، والحلقة تتطلب Series وSeason فعالين ومصدر Series فعالًا. إذا فشل التحقق يعاد `CONTENT_NOT_FOUND` بدل كشف سبب داخلي أو رابط المصدر.

## Android VOD

أصبح نقر الفيلم في الكتالوج أو البحث يفتح MovieDetails مع Poster وبيانات الوصف والتصنيف والسنة والتقييم والمدة قبل التشغيل. أما المسلسل فيفتح SeriesDetails والمواسم والحلقات. أخطاء تحميل التفاصيل تملك retry حقيقيًا بدل إعادة المستخدم للخلف.

يدعم `VodPlayerViewModel` الآن Continue Watching محليًا عبر Room الموجود: يحفظ الموضع كل عشر ثوانٍ، يحفظ الموضع قبل مغادرة الشاشة، يستعيد الموضع عند فتح الفيلم أو الحلقة مجددًا، ويحذف الموضع عند اكتمال التشغيل. لا توجد Room migration جديدة، ولا تتم مزامنة الموضع عبر الأجهزة بعد؛ تلك خطوة لاحقة تتطلب سياسة خصوصية وعقدًا حسابيًا واضحًا.

## الاشتراكات وأكواد التفعيل

يعرض `GET /api/v1/me/subscription` السجل المنتهي بحالة `EXPIRED` بدل تقديمه كاشتراك نشط في واجهة الحساب. أما صلاحية التشغيل فتظل تعتمد على `getActiveSubscription` الذي يفرض `expiresAt > now`، ويعاد فحص الاشتراك عند proxy playback أيضًا.

يحمي `POST /api/v1/activation/redeem` من محاولات التخمين المتكررة: يسمح بحد أقصى 10 محاولات لكل مستخدم خلال 10 دقائق، ثم يعيد HTTP 429 مع `ACTIVATION_RATE_LIMITED` و`Retry-After`. لا يتم حفظ الكود الخام.

| كود الخطأ | المعنى في التطبيق |
|---|---|
| `INVALID_CODE` | الكود غير صالح أو ناقص. |
| `CODE_ALREADY_USED` | الكود استُخدم من قبل. |
| `CODE_EXPIRED` | انتهت صلاحية الكود. |
| `PLAN_UNAVAILABLE` | الخطة المرتبطة بالكود غير متاحة. |
| `DEVICE_LIMIT_REACHED` | تم بلوغ حد الأجهزة في الخطة. |
| `SUBSCRIPTION_EXPIRED` | انتهى الاشتراك ويجب تفعيل كود جديد. |
| `ACTIVATION_RATE_LIMITED` | تجاوز المستخدم عدد محاولات التفعيل المسموح. |

تم تحديث Android ليعرض هذه الحالات بالعربية بدل رسائل HTTP عامة، مع تعريب قسم الاشتراك وحالة الخطة والأجهزة والزر والإشعارات.

## حدود ما تبقى

لم تُنفذ بعد مزامنة Continue Watching عبر الأجهزة، سجل المشاهدة الحسابي، اختيار الصوت والترجمة، أو شاشة MovieDetails غنية بمعلومات إضافية من مزود Xtream. كما يحتاج التشغيل الفعلي على Android TV أو Fire TV إلى APK وEmulator أو جهاز فعلي.
