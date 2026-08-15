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
