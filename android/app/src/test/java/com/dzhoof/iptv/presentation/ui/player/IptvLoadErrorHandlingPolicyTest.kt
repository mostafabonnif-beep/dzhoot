package com.dzhoof.iptv.presentation.ui.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.ParserException
import androidx.media3.common.util.UnstableApi
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for the fast-fail IPTV load error policy (defect D6).
 */
@OptIn(UnstableApi::class)
class IptvLoadErrorHandlingPolicyTest {

    private val policy = IptvLoadErrorHandlingPolicy()

    @Test
    fun `parser error never retries`() {
        val error = ParserException.createForMalformedContainer("bad container", null)
        assertEquals(C.TIME_UNSET, policy.retryDelayMsFor(error, 1))
        assertEquals(C.TIME_UNSET, policy.retryDelayMsFor(error, 5))
    }

    @Test
    fun `unsupported container feature never retries`() {
        val error = ParserException.createForUnsupportedContainerFeature("unsupported")
        assertEquals(C.TIME_UNSET, policy.retryDelayMsFor(error, 1))
    }

    @Test
    fun `network io error retries exactly once`() {
        val error = IOException("connection reset")
        assertEquals(
            IptvLoadErrorHandlingPolicy.NETWORK_RETRY_DELAY_MS,
            policy.retryDelayMsFor(error, 1),
        )
        assertEquals(C.TIME_UNSET, policy.retryDelayMsFor(error, 2))
    }

    @Test
    fun `minimum loadable retry count is one for all data types`() {
        assertEquals(1, policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA))
        assertEquals(1, policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA_PROGRESSIVE_LIVE))
    }
}
