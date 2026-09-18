package com.dzhoof.iptv.presentation.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamErrorMessageResolverTest {

    private fun context(errorMessage: String) = StreamErrorContext(
        errorMessage = errorMessage,
        lastCheckedAt = null,
        previousStatus = null,
        categoryOfflineCount = 0,
        categoryScannedCount = 0,
    )

    // ── No-broadcast-now (empty event playlist) ──────────────────

    @Test
    fun `no content message resolves to no broadcast right now`() {
        val resolved = StreamErrorMessageResolver.resolve(
            context(ErrorRecoveryManager.NO_CONTENT_MESSAGE),
        )

        assertEquals("لا يوجد بث حاليًا", resolved.title)
        assertTrue(resolved.explanation.contains("حدث أو مباراة"))
    }

    @Test
    fun `no content diagnostic code also resolves to no broadcast right now`() {
        val resolved = StreamErrorMessageResolver.resolve(
            context(ErrorRecoveryManager.NO_CONTENT_CODE),
        )

        assertEquals("لا يوجد بث حاليًا", resolved.title)
    }

    // ── Existing branches (regression guard) ─────────────────────

    @Test
    fun `network disconnection still resolves to connection lost`() {
        val resolved = StreamErrorMessageResolver.resolve(context("انقطع اتصال الشبكة"))

        assertEquals("انقطع الاتصال", resolved.title)
    }

    @Test
    fun `exhausted sources still resolves to channel unavailable`() {
        val resolved = StreamErrorMessageResolver.resolve(context("استُنفدت جميع مصادر البث"))

        assertEquals("القناة غير متاحة", resolved.title)
    }
}
