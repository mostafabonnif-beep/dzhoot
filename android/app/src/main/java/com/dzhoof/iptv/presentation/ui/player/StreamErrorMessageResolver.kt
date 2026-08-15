package com.dzhoof.iptv.presentation.ui.player

data class StreamErrorContext(
    val errorMessage: String,
    val lastCheckedAt: Long?,
    val previousStatus: String?,
    val categoryOfflineCount: Int,
    val categoryScannedCount: Int
)

data class StreamErrorMessage(
    val title: String,
    val explanation: String
)

object StreamErrorMessageResolver {

    private const val RECENT_THRESHOLD_MS = 3_600_000L // 1 hour

    fun resolve(context: StreamErrorContext): StreamErrorMessage {
        // Category-wide outage check
        if (context.categoryScannedCount >= 3 &&
            context.categoryOfflineCount >= context.categoryScannedCount / 2
        ) {
            return StreamErrorMessage(
                title = "مشكلة في مزود المصدر",
                explanation = "عدة قنوات في هذه المجموعة متوقفة. " +
                        "يبدو أن مزود المصدر يواجه مشكلة مؤقتة."
            ).withRecentSuffix(context)
        }

        val (title, explanation) = when {
            (context.errorMessage.contains("انقطع اتصال الشبكة") ||
                    context.errorMessage.contains("Network connection", ignoreCase = true)) ->
                "انقطع الاتصال" to
                        "فقد الجهاز اتصال الشبكة. تحقق من Wi-Fi أو كابل الشبكة ثم حاول مجددًا."

            (context.errorMessage.contains("خطأ في الخادم") ||
                    context.errorMessage.contains("Server error", ignoreCase = true)) ->
                "خادم البث لا يستجيب" to
                        "خادم بث القناة لا يستجيب حاليًا. قد تكون المشكلة مؤقتة لدى مزود المصدر."

            (context.errorMessage.contains("تنسيق البث غير صالح") ||
                    context.errorMessage.contains("Invalid stream format", ignoreCase = true)) ->
                "تنسيق البث غير متوافق" to
                        "تغير تنسيق البث أو لم يعد متوافقًا مع المشغل. قد يكون مزود المصدر حدّث قائمته."

            (context.errorMessage.contains("استُنفدت جميع مصادر البث") ||
                    context.errorMessage.contains("All streams exhausted", ignoreCase = true)) ->
                "القناة غير متاحة" to
                        "تمت تجربة جميع المصادر المتاحة لهذه القناة، ولا يستجيب أي منها حاليًا."

            else ->
                "البث غير متاح" to
                        "تعذر تحميل بث هذه القناة. قد تتوقف مصادر البث الخارجية مؤقتًا أو تعود للعمل لاحقًا."
        }

        return StreamErrorMessage(title, explanation).withRecentSuffix(context)
    }

    private fun StreamErrorMessage.withRecentSuffix(context: StreamErrorContext): StreamErrorMessage {
        if (context.previousStatus == "ONLINE" && context.lastCheckedAt != null) {
            val elapsed = System.currentTimeMillis() - context.lastCheckedAt
            if (elapsed < RECENT_THRESHOLD_MS) {
                return copy(
                    explanation = "$explanation كانت القناة تعمل مؤخرًا وقد تعود للعمل قريبًا."
                )
            }
        }
        return this
    }
}
