# Channel Operations API

## الهدف

يوفر هذا العقد ملخصًا تشغيليًا آمنًا للقنوات ومصادر M3U وXtream وEPG. المسار مخصص للمشرفين، ولا يعيد أي رابط Stream أو أسرار مصادر مشفرة.

## المسار

```http
GET /api/v1/admin/stats/channel-operations
Authorization: Bearer <admin-token>
```

## الاستجابة

```json
{
  "success": true,
  "data": {
    "channels": {
      "total": 120,
      "active": 118,
      "healthy": 100,
      "failing": 8,
      "unknown": 12,
      "withFallback": 73,
      "avgResponseTime": 412
    },
    "sources": {
      "m3u": [],
      "xtream": []
    },
    "identities": {
      "total": 105,
      "multiSource": 42,
      "lowConfidence": 18,
      "lastReconciledAt": "2026-08-15T12:00:00.000Z"
    },
    "epg": {
      "totalPrograms": 8500,
      "channelsWithEpg": 112,
      "totalSystemChannels": 120,
      "lastRefreshedAt": "2026-08-15T12:00:00.000Z",
      "nextRefreshAt": "2026-08-15T18:00:00.000Z",
      "sourcesDiscovered": 4,
      "refreshInProgress": false,
      "lastRefreshDurationMs": 18400,
      "lastRefreshProgramCount": 8500,
      "lastRefreshErrorCount": 0,
      "lastRefreshErrorSources": []
    },
    "generatedAt": "2026-08-15T12:00:01.000Z"
  }
}
```

## Reconcile هوية القنوات

```http
POST /api/v1/admin/channel-identities/reconcile
Authorization: Bearer <admin-token>
```

يعيد المسار عدد الهويات والقنوات المرتبطة وعدد الهويات متعددة المصادر وعدد المطابقات منخفضة الثقة. تتم المطابقة تلقائيًا عبر `tvg-id` الحقيقي بدرجة ثقة عالية، أو عبر الاسم والبلد بدرجة أقل. القنوات التي لا تملك tvg-id أو بلدًا لا تُدمج تلقائيًا مع قنوات أخرى؛ تُنشأ لها هوية منخفضة الثقة مرتبطة بمعرف المصدر حتى يراجعها المشرف.

## Sync Preview وRollback

تدعم إدارة M3U وXtream مسارات المشرف التالية:

| المسار | الوظيفة |
|---|---|
| `POST /api/v1/admin/m3u-sources/:id/preview` | تنزيل وتحليل المصدر وحساب `added/changed/removed/unchanged/blocked/duplicate` دون تطبيق التغييرات. |
| `POST /api/v1/admin/xtream-sources/:id/preview` | معاينة تغييرات Live TV في Xtream دون تطبيقها على الكتالوج. |
| `GET /api/v1/admin/{m3u-sources|xtream-sources}/:id/snapshots` | عرض سجل snapshots المختصر، دون تضمين القنوات أو الروابط. |
| `POST /api/v1/admin/{m3u-sources|xtream-sources}/:id/rollback/:snapshotId` | استرجاع آخر snapshot مطبق، مع التحقق من نوع المصدر وملكيته. |

تُحفظ حالة القنوات السابقة داخل snapshot مع تشفير `channelUrl` at-rest، وتُحذف snapshots تلقائيًا بعد 14 يومًا. المزامنة العادية تنشئ snapshot قبل التطبيق وتوسمه `applied` بعد نجاح التحديث. لا يمكن استرجاع snapshot ما لم يكن مطبقًا، وتُسجل عمليات preview وrollback في audit log.

## EPG Coverage وUnmatched Console

يعرض `GET /api/v1/admin/stats/epg-coverage` إجمالي القنوات، القنوات ذات البرنامج المطابق، النسبة الكلية، والقنوات غير المطابقة لكل مصدر EPG. الاستجابة تعرض `channelId` واسم القناة و`tvgId` فقط، ولا تعرض روابط القنوات أو أسرار المصادر. يستخدم المشرف هذه البيانات لإصلاح tvg-id أو إنشاء alias آمن قبل اعتماد دليل المصدر.

## QoE Telemetry المجهولة

يرسل تطبيق TV بعد محاولة التشغيل إلى `POST /api/v1/channels/:id/report-playback-event` الحقول الاختيارية التالية: `eventType` (`startup_success` أو `startup_failure`)، `startupMs`، `rebufferCount`، `fallbackUsed`، `fallbackSucceeded`، `errorCode`، `platform`، و`appVersion`. يفرض الخادم حدودًا للأرقام وحدًا أقصى 12 حدثًا لكل قناة لكل principal أو عنوان IP في الدقيقة.

لا يحفظ هذا المسار `deviceId` أو عنوان IP أو session ID أو user-agent أو stream URL؛ تُستخدم هوية الطلب في الذاكرة فقط لخفض الضوضاء. يعيد الخادم `202 Accepted` بعد التخزين الناجح. يعرض `GET /api/v1/admin/stats/playback-quality?days=7` ملخصًا يوميًا مجهولًا لزمن البدء، نسبة نجاح البدء، rebuffer، نجاح التحويل إلى البديل، وأكثر أكواد الخطأ شيوعًا.

## رؤوس المصدر في Failover

عند ترقية بديل إلى المصدر الأساسي، يمكن للخادم حفظ `user-agent` و`referrer` داخليًا. تُمرر هذه القيم داخل playback token المشفر فقط، ثم يستخدمها proxy عند الاتصال بالمصدر. لا تظهر هذه القيم في استجابات القنوات أو قوائم M3U/JSON، وتُرفض قيم headers التي تحتوي على CRLF أو تتجاوز حدود الطول.

## حقل `health` في استجابات القنوات

تضيف مسارات القنوات القائمة (`GET /channels` و`GET /channels/grouped` و`GET /channels/search` و`GET /channels/:id`) حقلًا اختياريًا لا يكسر العملاء القدامى:

```json
{
  "health": {
    "status": "healthy",
    "score": 84,
    "primaryStatus": "alive",
    "fallbackCount": 2,
    "successRate": 0.92,
    "responseTimeMs": 180,
    "lastCheckedAt": "2026-08-15T11:30:00.000Z",
    "recommendation": "primary"
  }
}
```

القيم الممكنة لـ`status` هي `healthy` و`degraded` و`unavailable` و`unknown`. القيم الممكنة لـ`recommendation` هي `primary` و`fallback` و`probe` و`offline`. لا يحتوي هذا الحقل على `channelUrl` أو `streamUrl`.

## قواعد حساب الصحة

تُحسب النتيجة من حالة الفحص الأساسي، وعدد البدائل الحية غير المحظورة، ونجاح تقارير التشغيل، وحداثة آخر فحص. النتيجة ليست ضمانًا لجودة المحتوى؛ هي مؤشر تشغيلي يساعد التطبيق ولوحة الإدارة على اختيار الإجراء المناسب. يظل التفويض بالاشتراك وحدود الجلسات وحماية SSRF مطبقًا قبل أي تشغيل.

## provenance لمصدر M3U

يحفظ نموذج القناة `metadata.m3uSourceId` عندما تكون القناة مستوردة من مصدر M3U. يستخدم EPG service هذا الحقل لتحديد القنوات التي يغطيها XMLTV الخاص بالمصدر، بينما يبقى الحقل غير ضروري لعملاء المشاهدة العاديين.
