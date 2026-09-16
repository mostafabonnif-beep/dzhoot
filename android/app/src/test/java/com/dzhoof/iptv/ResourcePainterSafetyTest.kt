package com.dzhoof.iptv

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * `painterResource` (and `vectorResource`) accept exactly two shapes of resource: a
 * **rasterized bitmap** (PNG, JPG, WEBP) or a **`<vector>`** XML. Every other XML root —
 * `<layer-list>`, `<selector>`, `<shape>`, `<ripple>`, `<animated-vector>`, `<bitmap>`,
 * `<adaptive-icon>` — throws at *composition* time:
 *
 * ```
 * java.lang.IllegalArgumentException: Only VectorDrawables and rasterized asset types are
 * supported ex. PNG, JPG, WEBP
 * ```
 *
 * and takes the whole screen down with it. Nothing catches this earlier: the resource id is
 * an `Int`, so the compiler is blind, and the failure needs a rendered frame, so no unit test
 * sees it. That is how `SideNavRail` shipped a `<layer-list>` as the brand mark and every
 * landscape session on a top-level route crashed for weeks (3 reports from a Samsung
 * SM-A057G on 1.0.48, all unread).
 *
 * This test is a **source-and-resource scan on purpose**: no device, no Robolectric, no
 * rendering, milliseconds to run, and it fails naming the exact file, the exact resource and
 * the exact XML root tag. If someone points a painter at a `<shape>` again, this is where
 * they find out — not a customer's crash report.
 */
class ResourcePainterSafetyTest {

    private data class Use(
        val kind: String,
        val name: String,
        val source: File,
        val line: Int,
    )

    @Test
    fun `every resource handed to a painter is a vector or a raster`() {
        val moduleRoot = moduleRoot()
        val sources = File(moduleRoot, "src/main/java")
            .walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .toList()
        assertTrue("no Kotlin sources found under $moduleRoot", sources.isNotEmpty())

        val uses = sources.flatMap { file ->
            val text = file.readText()
            USAGE.findAll(text).map { match ->
                Use(
                    kind = match.groupValues[1],
                    name = match.groupValues[2],
                    source = file,
                    line = text.take(match.range.first).count { it == '\n' } + 1,
                )
            }
        }

        // Without this the test would "pass" forever if the scan itself broke — the same
        // silent-skip failure that let `catalog-helpers.test.js` go unexecuted for months on
        // the server side.
        assertTrue(
            "found no painterResource/vectorResource call sites — the scan is broken, not the code",
            uses.isNotEmpty(),
        )

        val problems = uses.mapNotNull { rejection(moduleRoot, it) }
        if (problems.isNotEmpty()) {
            fail(
                "A painter was handed a resource Compose cannot load. On a device this is " +
                    "`IllegalArgumentException: Only VectorDrawables and rasterized asset types " +
                    "are supported`, thrown while composing the screen that draws it.\n\n" +
                    problems.joinToString("\n\n") +
                    "\n\nFix: point the painter at a raster (PNG/JPG/WEBP) or a plain <vector>.",
            )
        }
    }

    /** Returns a human-readable rejection, or null when the use is safe. */
    private fun rejection(moduleRoot: File, use: Use): String? {
        val candidates = candidateFiles(moduleRoot, use)
        if (candidates.isEmpty()) {
            return "${where(use)} references R.${use.kind}.${use.name}, but no such resource " +
                "exists under src/main/res/${use.kind}*. (Renamed or deleted?)"
        }
        val offenders = candidates.mapNotNull { file ->
            val root = xmlRootTag(file) ?: return@mapNotNull null // raster: always fine
            if (root == "vector") null
            else "${file.relativeTo(moduleRoot)} has root <$root>"
        }
        if (offenders.isEmpty()) return null
        return buildString {
            append(where(use))
            append(" references R.${use.kind}.${use.name}:\n")
            offenders.forEach { append("    ").append(it).append('\n') }
            if (candidates.any { it.extension != "xml" }) {
                append("    (a raster variant of the same name also exists — which one wins is ")
                append("density-dependent, so this is rejected either way)\n")
            }
        }
    }

    private fun where(use: Use): String =
        "${use.source.path.substringAfter("/src/")}:${use.line}"

    /** Every file that could provide this resource id, across density variants. */
    private fun candidateFiles(moduleRoot: File, use: Use): List<File> {
        val res = File(moduleRoot, "src/main/res")
        if (!res.isDirectory) return emptyList()
        val dirNames = Regex("^${use.kind}(-.*)?$")
        return res.listFiles()
            .orEmpty()
            .filter { it.isDirectory && dirNames.matches(it.name) }
            .flatMap { dir ->
                dir.listFiles().orEmpty().filter { file ->
                    file.isFile && file.nameWithoutExtension == use.name && file.extension in RASTER_EXTENSIONS + "xml"
                }
            }
    }

    /**
     * The XML root tag, or null when the file is not XML.
     *
     * A malformed file returns `"<unparseable>"` rather than null: an unreadable drawable must
     * not be mistaken for a raster.
     */
    private fun xmlRootTag(file: File): String? {
        if (file.extension != "xml") return null
        return runCatching {
            val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = false }
            factory.newDocumentBuilder().parse(file).documentElement.tagName
        }.getOrElse { "<unparseable: ${it.javaClass.simpleName}>" }
    }

    /**
     * The Android module directory (`…/android/app`) — the directory that holds
     * `src/main/res`. Gradle runs unit tests with the working directory set to the module
     * project, but that is a convention rather than a guarantee, so this walks up from both
     * the working directory and the user dir before giving up loudly.
     */
    private fun moduleRoot(): File {
        val starts = listOf(
            File("").absoluteFile,
            (System.getProperty("user.dir")?.let { File(it) } ?: File("")).absoluteFile,
        ).distinct()

        for (start in starts) {
            var dir = start
            var depth = 0
            while (depth < MAX_ASCENT) {
                if (File(dir, "src/main/res").isDirectory) return dir
                dir = dir.parentFile ?: break
                depth++
            }
        }
        fail(
            "Could not locate the Android module (`src/main/res`). Tried ascending from " +
                starts.joinToString { it.path } + ". This test refuses to pass when it cannot " +
                "see the resources — a silent skip is how an unrun test stays green.",
        )
        error("unreachable: fail() throws")
    }

    private companion object {
        val USAGE = Regex("""(?:painterResource|vectorResource)\s*\(\s*(?:id\s*=\s*)?R\.(drawable|mipmap)\.(\w+)""")
        val RASTER_EXTENSIONS = setOf("png", "jpg", "jpeg", "webp")
        const val MAX_ASCENT = 5
    }
}
