package com.dzhoof.iptv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A debug log line must never contain a credential.
 *
 * `AGENTS.md`: "Do not expose Xtream credentials in Android logs, URLs shown to
 * users, screenshots, or API responses". An Xtream account lives in the URL
 * (`/live/<user>/<pass>/123.ts`, `player_api.php?username=…&password=…`), and a
 * managed playback URL carries its token in the path — so redacting headers alone
 * is not enough, which is how `Level.HEADERS` leaked them.
 */
class RequestLogRedactorTest {

    @Test
    fun `masks the xtream credentials in the path and keeps the media type`() {
        val summary = RequestLogRedactor.summarize(
            "https://panel.example.com/live/8f3c1d9b7a2e4f60/9a1b2c3d4e5f6071/262849.m3u8",
        )

        assertEquals("https://panel.example.com/live/***/***/262849.m3u8", summary)
        assertFalse(summary.contains("8f3c1d9b7a2e4f60"))
        assertFalse(summary.contains("9a1b2c3d4e5f6071"))
    }

    @Test
    fun `drops the query string entirely`() {
        val summary = RequestLogRedactor.summarize(
            "https://panel.example.com/player_api.php?username=alice&password=s3cret&action=get_live_streams",
        )

        assertEquals(
            "https://panel.example.com/player_api.php (query hidden: 3 params)",
            summary,
        )
        assertFalse(summary.contains("alice"))
        assertFalse(summary.contains("s3cret"))
    }

    @Test
    fun `masks a managed playback token but keeps the extension`() {
        val summary = RequestLogRedactor.summarize(
            "https://iptv.ld-11.net/api/v1/tv/playback/AbCd0123456789EfGhIjKl.m3u8",
        )

        assertEquals("https://iptv.ld-11.net/api/v1/tv/playback/***.m3u8", summary)
    }

    @Test
    fun `keeps ordinary endpoints readable`() {
        assertEquals(
            "https://iptv.ld-11.net/api/v1/channels",
            RequestLogRedactor.summarize("https://iptv.ld-11.net/api/v1/channels"),
        )
        // A query on the managed API is still hidden (it can carry a code).
        assertEquals(
            "https://iptv.ld-11.net/api/v1/channels (query hidden: 2 params)",
            RequestLogRedactor.summarize("https://iptv.ld-11.net/api/v1/channels?page=1&pageSize=5000"),
        )
    }

    @Test
    fun `short path segments are not masked`() {
        assertEquals(
            "https://host.example/api/v1/tv/logo",
            RequestLogRedactor.summarize("https://host.example/api/v1/tv/logo"),
        )
        assertFalse(RequestLogRedactor.isSecretShaped("logo"))
        assertFalse(RequestLogRedactor.isSecretShaped("player_api.php"))
    }

    @Test
    fun `token shaped segments are recognised`() {
        assertTrue(RequestLogRedactor.isSecretShaped("AbCd0123456789EfGhIj"))
        assertTrue(RequestLogRedactor.isSecretShaped("AbCd0123456789EfGhIj.m3u8"))
    }

    @Test
    fun `a malformed url is still redacted rather than throwing`() {
        // The logger runs on every request; a parse failure must not become a crash.
        val summary = RequestLogRedactor.summarize("not a url at all")

        assertFalse(summary.contains("?"))
        assertTrue(summary.isNotEmpty())
    }

    @Test
    fun `the endpoint label never carries the query or a token`() {
        val url = okhttp3.HttpUrl.Builder()
            .scheme("https")
            .host("panel.example.com")
            .addPathSegment("live")
            .addPathSegment("8f3c1d9b7a2e4f60")
            .addQueryParameter("password", "s3cret")
            .build()

        assertEquals("/live/***", RequestLogRedactor.endpointLabel(url))
    }
}
