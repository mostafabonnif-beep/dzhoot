package com.dzhoof.iptv.presentation.ui.player

import com.dzhoof.iptv.domain.model.HEALTH_EVIDENCE_WINDOW_MS

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

    /**
     * How recent a health result must be to count towards the category-wide verdict, and to
     * be described as "recently working". Shared with the UI's health display
     * ([HEALTH_EVIDENCE_WINDOW_MS]) so the two cannot drift apart.
     */
    const val RECENT_WINDOW_MS = HEALTH_EVIDENCE_WINDOW_MS

    private const val RECENT_THRESHOLD_MS = RECENT_WINDOW_MS

    /**
     * Below this many checked channels a "half the group is down" verdict is noise, not signal.
     */
    private const val MIN_CATEGORY_SAMPLE = 3

    /**
     * The category-wide verdict: is this a source-provider problem rather than one bad channel?
     *
     * Pure so the rule is unit-tested in isolation, and a *true* half on purpose: the previous
     * `offlineCount >= scannedCount / 2` used integer division, so with 3 checked channels the bar
     * was 1 — a single zapped channel that happened to fail announced "the provider is down".
     * The caller must pass counts that cover the SAME recent window — see [RECENT_WINDOW_MS]
     * and ChannelHealthDao.
     */
    fun isCategoryWideOutage(scannedCount: Int, offlineCount: Int): Boolean =
        scannedCount >= MIN_CATEGORY_SAMPLE && offlineCount * 2 >= scannedCount

    fun resolve(context: StreamErrorContext): StreamErrorMessage {
        // Category-wide outage check
        if (isCategoryWideOutage(context.categoryScannedCount, context.categoryOfflineCount)) {
            return StreamErrorMessage(
                title = "مشكلة في مزود المصدر",
                explanation = "عدة قنوات في هذه المجموعة متوقفة. " +
                        "يبدو أن مزود المصدر يواجه مشكلة مؤقتة."
            ).withRecentSuffix(context)
        }

        val (title, explanation) = when {
            (context.errorMessage.contains(ErrorRecoveryManager.NO_CONTENT_MESSAGE) ||
                    context.errorMessage.contains("no_content_now")) ->
                "لا يوجد بث حاليًا" to
                        "هذه القناة تبثّ عند وجود حدث أو مباراة فقط، ولا يوجد بث في هذه اللحظة. جرّب قناة أخرى."

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
