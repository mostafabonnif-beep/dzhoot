package com.dzhoof.iptv.presentation.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression: the "source provider problem" banner must be a *recent*, evidence-based verdict.
 *
 * An OFFLINE mark is written on every playback failure and used to be counted with no time
 * bound, so a handful of unrelated transient failures (flaky free M3U stream, expired token,
 * concurrent-stream limit, one bad network moment) accumulated until half a category looked
 * dead and the player blamed the provider for a group that was healthy.
 *
 * The window itself is enforced in ChannelHealthDao (`lastCheckedAt >= :since`); these tests
 * pin the pure verdict rule and the window constant the caller must use.
 *
 * Also pins the "no broadcast right now" verdict: an event channel between events answers with
 * an HTTP 200 and an empty body, which is not a failure and must not be reported as one.
 */
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

    // ── Category-wide outage verdict ─────────────────────────────

    @Test
    fun `a full category of healthy channels is not a provider outage`() {
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 10, offlineCount = 0))
    }

    @Test
    fun `a minority of failures is not a provider outage`() {
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 10, offlineCount = 4))
    }

    @Test
    fun `half the category failing is a provider outage`() {
        assertTrue(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 10, offlineCount = 5))
    }

    @Test
    fun `every channel failing is a provider outage`() {
        assertTrue(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 4, offlineCount = 4))
    }

    @Test
    fun `a tiny sample is never a provider outage`() {
        // Two channels out of two failing is one person zapping, not a provider outage.
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 2, offlineCount = 2))
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 0, offlineCount = 0))
    }

    @Test
    fun `the verdict needs three checked channels`() {
        assertTrue(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 3, offlineCount = 2))
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 3, offlineCount = 1))
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 3, offlineCount = 0))
    }

    @Test
    fun `the bar is a true half, not integer division`() {
        // `offlineCount >= scannedCount / 2` made the bar 1 of 3 (integer division), so one
        // unlucky channel announced a provider outage. Pin the corrected rule.
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 3, offlineCount = 1))
        assertFalse(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 5, offlineCount = 2))
        assertTrue(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 5, offlineCount = 3))
        assertTrue(StreamErrorMessageResolver.isCategoryWideOutage(scannedCount = 6, offlineCount = 3))
    }

    @Test
    fun `the recency window is one hour and is shared`() {
        assertEquals(3_600_000L, StreamErrorMessageResolver.RECENT_WINDOW_MS)
    }

    @Test
    fun `a category-wide outage reports the source provider`() {
        val message = StreamErrorMessageResolver.resolve(
            StreamErrorContext(
                errorMessage = "أي شيء",
                lastCheckedAt = null,
                previousStatus = null,
                categoryOfflineCount = 5,
                categoryScannedCount = 10,
            ),
        )
        assertEquals("مشكلة في مزود المصدر", message.title)
    }

    @Test
    fun `a healthy category still reports the specific error`() {
        val message = StreamErrorMessageResolver.resolve(
            StreamErrorContext(
                errorMessage = "استُنفدت جميع مصادر البث",
                lastCheckedAt = null,
                previousStatus = null,
                categoryOfflineCount = 0,
                categoryScannedCount = 10,
            ),
        )
        assertEquals("القناة غير متاحة", message.title)
    }
}
