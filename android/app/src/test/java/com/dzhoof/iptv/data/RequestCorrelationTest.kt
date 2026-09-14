package com.dzhoof.iptv.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Correlation ids (operations brief §7C): one random label per managed API request, shown in
 * diagnostics so support can find the exact server log line — and never attached to a
 * third-party host.
 */
class RequestCorrelationTest {

    @After
    fun tearDown() {
        RequestCorrelation.reset()
    }

    @Test
    fun `generates a random uuid per request`() {
        val first = RequestCorrelation.newRequestId()
        val second = RequestCorrelation.newRequestId()

        assertTrue(
            "not a uuid: $first",
            Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
                .matches(first),
        )
        assertNotEquals(first, second)
    }

    @Test
    fun `prefers the server echo over the id we sent`() {
        RequestCorrelation.recordClientId("11111111-1111-1111-1111-111111111111")
        assertEquals(
            "11111111-1111-1111-1111-111111111111",
            RequestCorrelation.lastCorrelationId(),
        )

        RequestCorrelation.recordServerId("22222222-2222-2222-2222-222222222222")
        assertEquals(
            "22222222-2222-2222-2222-222222222222",
            RequestCorrelation.lastCorrelationId(),
        )
    }

    @Test
    fun `ignores a blank server echo and a blank client id`() {
        RequestCorrelation.recordClientId("33333333-3333-3333-3333-333333333333")
        RequestCorrelation.recordServerId("")
        RequestCorrelation.recordServerId(null)

        assertEquals(
            "33333333-3333-3333-3333-333333333333",
            RequestCorrelation.lastCorrelationId(),
        )

        RequestCorrelation.reset()
        assertNull(RequestCorrelation.lastCorrelationId())
        RequestCorrelation.recordClientId("   ")
        assertNull(RequestCorrelation.lastCorrelationId())
    }

    @Test
    fun `correlates only the DZ HOOF API host`() {
        assertTrue(RequestCorrelation.isManagedHost("iptv.ld-11.net", "iptv.ld-11.net"))
        assertTrue(RequestCorrelation.isManagedHost("IPTV.LD-11.NET", "iptv.ld-11.net"))
        assertTrue(RequestCorrelation.isManagedHost("iptv.ld-11.net", " iptv.ld-11.net "))

        assertFalse(RequestCorrelation.isManagedHost("cdn.example.com", "iptv.ld-11.net"))
        assertFalse(RequestCorrelation.isManagedHost("iptv.ld-11.net.evil.example", "iptv.ld-11.net"))
        assertFalse(RequestCorrelation.isManagedHost("iptv.ld-11.net", null))
        assertFalse(RequestCorrelation.isManagedHost("iptv.ld-11.net", ""))
        assertFalse(RequestCorrelation.isManagedHost(null, "iptv.ld-11.net"))
    }
}
