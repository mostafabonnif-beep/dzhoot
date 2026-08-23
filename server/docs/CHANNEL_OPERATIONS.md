# Channel Operations

## مبدأ التشغيل

قنوات catalog العامة لا تصبح قابلة للمشاهدة عند الاستيراد مباشرة. دورة حياتها تبدأ بـ`pending_verification` ولا تظهر للعملاء إلا بعد انتقال صريح إلى `active`. يمنع هذا عرض روابط غير مختبرة أو محتوى من مصدر لم توافق عليه العمليات.

| الحالة | المعنى | مرئية للعملاء |
|---|---|---:|
| `pending_verification` | مستوردة وتنتظر فحصاً وموافقة | لا |
| `active` | تحققت العمليات منها وسمحت بعرضها | نعم |
| `degraded` | تدهور معروف؛ تحتاج مراجعة | لا |
| `disabled` | إيقاف قابل للاسترجاع | لا |
| `archived` | أرشفة تشغيلية بدلاً من حذف فعلي | لا |

`isActive` يبقى للتوافق مع الخدمات القديمة، لكن قرار ظهور catalog يتطلب `lifecycleStatus=active` أيضاً. لا ينبغي استخدام `isActive=true` وحده كدليل على أن القناة منشورة.

## الاستيراد والتحقق

أي مسار استيراد catalog، سواء M3U أو Xtream أو مزامنة مصدر، يجب أن يكتب `pending_verification` صراحةً. بعد الاستيراد يجب فحص حالة البث وmetadata المصدر وحقوق إعادة البث، ثم يفعّل مشغّل مخول القنوات التي نجحت فقط.

> لا تغير هذه السياسة سلوك BYO/private channels بصورة عمياء. القناة التي يملكها مستخدم تخصه تبقى معزولة عن catalog، ولا تدخل قائمة العملاء الآخرين.

يجب أن تظل URLs ومفاتيح DRM وheaders الخاصة بالمصادر داخل الخادم. قائمة العميل تستقبل playback URL موقّعاً أو مشفراً فقط.

## عمليات الإدارة

| العملية | Endpoint | تأكيد مطلوب | أثرها |
|---|---|---:|---|
| تعيين lifecycle لقناة | `PATCH /admin/channels/:id/lifecycle` | لـ`disabled` و`archived` | يحدّث الحالة و`isActive` ووقت التحديث |
| تفعيل/تعطيل مجموعة | `PATCH /admin/channels/bulk` | عند التعطيل | ينقل إلى `active` أو`disabled` |
| أرشفة مجموعة محددة | `DELETE /admin/channels/bulk` | نعم | soft archive؛ لا حذف فيزيائياً |
| أرشفة حسب الصحة | `DELETE /admin/channels/bulk-by-status` | نعم | يؤرشف لا يحذف |
| أرشفة قناة واحدة | `DELETE /admin/channels/:id` | نعم | قابلة للاستعادة بتعيين lifecycle مناسب |

واجهة الإدارة يجب أن تسمي العملية **أرشفة** لا حذف. الأرشفة تسجل في audit log وتبطل cache الكتالوج. الاستعادة تتم عبر lifecycle إلى `active` فقط بعد تحقق جديد، أو `pending_verification` عند الحاجة إلى مراجعة إضافية.

## Migration للبيانات القائمة

البرنامج `0011-channel-lifecycle-backfill.ts` يعمل dry-run افتراضياً. يصنف البيانات القديمة كالآتي:

| حالة قديمة | الحالة المقترحة |
|---|---|
| `isActive=false` | `disabled` |
| `metadata.isWorking=false` أو قناة معلّمة سيئة | `degraded` |
| مفعلة وسليمة | `active` |

راجع ناتج dry-run في staging أولاً. لا تشغّل migration على production ضمن طلب تطوير أو قبل وجود backup صالح، change window، وخطة rollback. بعد التحقق فقط شغّل الأمر الموثق في `server/backend/package.json` ضمن release مراجع.

## مراقبة العمليات

`GET /admin/stats/stream-health` يعرض عدادات lifecycle: active وpending وdegraded وdisabled وarchived، إلى جانب health وresponse time. راقب ارتفاع pending بعد استيراد أو ارتفاع degraded بعد تغيير مصدر.

لا يعد ارتفاع `metadata.isWorking=true` بحد ذاته موافقة للنشر: يجب تأكيد الحقوق، جودة المصدر، وسياسة المحتوى قبل `active`.

## قائمة تحقق للمشغّل

1. تحقق من حق إعادة البث ومصدر القناة قبل الاستيراد.
2. راجع `pending_verification` بعد كل import/sync ولا تفعّلها جماعياً دون فحص.
3. استخدم الأرشفة عند الإزالة التشغيلية؛ لا تحذف السجل أو بيانات التدقيق.
4. أعد اختبار القناة قبل الاستعادة إلى `active`.
5. لا تصدر أو تشارك URL المصدر الخام أثناء الدعم أو التحقيق.
