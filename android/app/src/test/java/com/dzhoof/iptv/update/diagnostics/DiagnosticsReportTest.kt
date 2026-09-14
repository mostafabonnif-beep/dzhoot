package com.dzhoof.iptv.update.diagnostics

import com.dzhoof.iptv.update.UpdateDistribution
import com.dzhoof.iptv.update.UpdateErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the pure diagnostics builder.
 *
 * The security tests are the important ones: a hostile value (URL / JWT / username) must
 * never survive into either the display rows or the copyable support report.
 */
class DiagnosticsReportTest {

    private val healthyFacts = DiagnosticsFacts(
        appVersionName = "1.2.6",
        appVersionCode = 10206,
        releaseChannel = "staging",
        distributionWireName = UpdateDistribution.EXTERNAL_APK.wireName,
        lastCheckAtMillis = 1_700_000_000_000L,
        lastCheckResultCode = "up_to_date",
        androidRelease = "14",
        sdkInt = 34,
        signingCertSha256 = "ab".repeat(32),
        serverVersion = "1.0.1",
        serverCommit = "59ad81fe028f89f7b8114f22a942d3f2b4fd602b",
        serverBuiltAt = "2026-09-13T19:50:45Z",
        serverEnvironment = "production",
        serverAvailable = true,
    )

    @Test
    fun `report contains app version versionCode and channel`() {
        val report = DiagnosticsReport.reportText(healthyFacts)
        assertTrue(report.contains("1.2.6"))
        assertTrue(report.contains("10206"))
        assertTrue(report.contains("staging"))
    }

    @Test
    fun `report contains distribution and what it means for updates`() {
        val report = DiagnosticsReport.reportText(healthyFacts)
        assertTrue(report.contains("external_apk"))
        // Arabic explanation, not just the wire name.
        assertTrue(report.contains("تثبيت يدوي"))
    }

    @Test
    fun `report contains last check time and human result`() {
        val report = DiagnosticsReport.reportText(healthyFacts)
        assertTrue(report.contains(DiagnosticsReport.SECTION_LAST_CHECK))
        assertTrue(report.contains("آخر فحص"))
        assertTrue(report.contains("التطبيق محدَّث"))
    }

    @Test
    fun `report contains server and device identity`() {
        val report = DiagnosticsReport.reportText(healthyFacts)
        assertTrue(report.contains("1.0.1"))
        assertTrue(report.contains("59ad81fe")) // commit shortened to 8 chars, lowercase
        assertTrue(report.contains("2026-09-13T19:50:45Z"))
        assertTrue(report.contains("production"))
        assertTrue(report.contains("14"))
        assertTrue(report.contains("34"))
        assertTrue(report.contains("ab".repeat(32)))
    }

    @Test
    fun `sections carry the four expected titles`() {
        val titles = DiagnosticsReport.sections(healthyFacts).map { it.title }
        assertEquals(
            listOf(
                DiagnosticsReport.SECTION_APP,
                DiagnosticsReport.SECTION_LAST_CHECK,
                DiagnosticsReport.SECTION_SERVER,
                DiagnosticsReport.SECTION_DEVICE,
            ),
            titles,
        )
    }

    @Test
    fun `unavailable server renders as not available without failing the rest`() {
        val facts = healthyFacts.copy(serverAvailable = false, serverVersion = null)
        val report = DiagnosticsReport.reportText(facts)
        assertTrue(report.contains(DiagnosticsReport.NOT_AVAILABLE))
        // The local sections still render.
        assertTrue(report.contains("1.2.6"))
        assertTrue(report.contains("34"))
    }

    @Test
    fun `every surfaced update error code maps to its Arabic message`() {
        UpdateErrorCode.entries.forEach { code ->
            val report = DiagnosticsReport.reportText(
                healthyFacts.copy(lastCheckResultCode = code.name),
            )
            assertTrue(
                "missing message for ${code.name}",
                report.contains(code.userMessage),
            )
        }
    }

    @Test
    fun `available and skipped labels map to human Arabic`() {
        assertTrue(
            DiagnosticsReport.reportText(healthyFacts.copy(lastCheckResultCode = "available"))
                .contains("يتوفر تحديث جديد"),
        )
        assertTrue(
            DiagnosticsReport.reportText(healthyFacts.copy(lastCheckResultCode = "skipped"))
                .contains("تم تخطي الفحص"),
        )
    }

    @Test
    fun `unknown result code is not echoed`() {
        val report = DiagnosticsReport.reportText(
            healthyFacts.copy(lastCheckResultCode = "SOME_UNKNOWN_CODE"),
        )
        assertFalse(report.contains("SOME_UNKNOWN_CODE"))
        assertTrue(report.contains(DiagnosticsReport.UNKNOWN))
    }

    @Test
    fun `distribution labels cover all paths and reject unknown`() {
        UpdateDistribution.entries.forEach { distribution ->
            val label = DiagnosticsReport.distributionLabel(distribution.wireName)
            assertTrue(label.startsWith(distribution.wireName))
        }
        assertEquals(
            DiagnosticsReport.NOT_AVAILABLE,
            DiagnosticsReport.distributionLabel("http://evil.example/xtream"),
        )
        assertEquals(DiagnosticsReport.NOT_AVAILABLE, DiagnosticsReport.distributionLabel(null))
    }

    // ── Security ──────────────────────────────────────────────────────────────

    @Test
    fun `hostile values never reach the report or the sections`() {
        val fakeJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJzdWIiOiJ1c2VyMTIzNDU2Nzg5MCJ9." +
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        val hostile = DiagnosticsFacts(
            appVersionName = "http://portal.example.com/playlist.m3u?username=alice&password=s3cr3t",
            appVersionCode = 10206,
            releaseChannel = fakeJwt,
            distributionWireName = "http://evil.example/xtream",
            lastCheckAtMillis = 1_700_000_000_000L,
            lastCheckResultCode = fakeJwt,
            androidRelease = "https://evil.example/epg.xml",
            sdkInt = 34,
            signingCertSha256 = "not-a-real-hash",
            serverVersion = fakeJwt,
            serverCommit = "http://evil.example/token",
            serverBuiltAt = "https://evil.example/m3u",
            serverEnvironment = "user@example.com",
            serverAvailable = true,
        )

        val report = DiagnosticsReport.reportText(hostile)
        val sectionText = DiagnosticsReport.sections(hostile)
            .flatMap { it.lines }
            .joinToString("\n") { "${it.label}: ${it.value}" }

        val forbidden = listOf(
            "http", "://", "@", "playlist", "username", "password", "s3cr3t",
            "alice", "evil.example", "xtream", "epg", "token", "eyJ",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "m3u",
        )
        forbidden.forEach { marker ->
            assertFalse("leaked '$marker' in report", report.contains(marker, ignoreCase = true))
            assertFalse("leaked '$marker' in sections", sectionText.contains(marker, ignoreCase = true))
        }

        // The screen still renders, with placeholders instead of the hostile values.
        assertTrue(report.contains(DiagnosticsReport.NOT_AVAILABLE))
        assertTrue(report.contains("10206"))
    }

    @Test
    fun `sensitive-shaped version strings are dropped`() {
        val report = DiagnosticsReport.reportText(
            healthyFacts.copy(serverVersion = "1.2.3-token-ABCDEF", releaseChannel = "user@host"),
        )
        assertFalse(report.contains("ABCDEF"))
        assertFalse(report.contains("user@host"))
    }
}
