package com.dzhoof.iptv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Lazy list keys must be unique **by construction**.
 *
 * `LazyColumn`/`LazyRow`/`LazyVerticalGrid` throw at composition time when two
 * items in the same list resolve to the same key:
 *
 * ```
 * java.lang.IllegalArgumentException: Key "رياضة" was already used.
 * If you are using LazyColumn/Row please make sure you provide a unique key for each item.
 * ```
 *
 * That is not hypothetical: three crash reports from a Samsung SM-S906B carry
 * exactly that message with the category label "رياضة". A channel-group label is
 * not unique — the same group can arrive from two sources, and a merged catalog
 * legitimately lists the same id twice — so `key = { it.name }` is a crash waiting
 * for the right catalog.
 *
 * The rule enforced here is the convention the codebase already follows in 20+
 * call sites: **prefix the key with the item's position**
 * (`key = { i, ch -> "$i:${ch.id}" }`). Position-prefixed keys cannot collide.
 *
 * Source scan on purpose (same reasoning as [ResourcePainterSafetyTest]): no
 * device, no Robolectric, milliseconds, and the failure names the exact file and
 * line. A rendered frame is what the real crash needs; this test does not.
 *
 * The scan only looks inside calls to the lowercase Compose DSL functions
 * (`item` / `items` / `itemsIndexed`), so data-class arguments such as
 * `CatalogPosterItem(key = it.id, …)` are not mistaken for lazy keys.
 */
class LazyListKeyUniquenessTest {

    private data class KeyUse(
        val source: File,
        val line: Int,
        val kind: Kind,
        val params: List<String> = emptyList(),
        val body: String = "",
        val raw: String,
    ) {
        enum class Kind { LITERAL, REFERENCE, IMPLICIT_IT, LAMBDA, UNPARSED }
    }

    private companion object {
        /** Compose's lazy-item DSL, always lowercase. */
        val ITEM_CALL = Regex("""\b(itemsIndexed|items|item)\s*\(""")

        /** A `key =` argument inside such a call — but not an `==` comparison. */
        val KEY_ARG = Regex("""\bkey\s*=(?!=)""")

        /** Parameter names that read as a position rather than as an item. */
        val INDEX_LIKE = Regex("""^(i|idx|index|n)$""", RegexOption.IGNORE_CASE)

        fun lineOf(text: String, offset: Int): Int = text.take(offset).count { it == '\n' } + 1

        /**
         * End of the argument list that starts at [open] (index of the `(`),
         * by balanced-parenthesis scan. Returns the end index of the window.
         */
        fun callWindow(text: String, open: Int): Int {
            var depth = 0
            var i = open
            var inString = false
            while (i < text.length) {
                val c = text[i]
                when {
                    c == '"' && (i == 0 || text[i - 1] != '\\') -> inString = !inString
                    inString -> Unit
                    c == '(' -> depth++
                    c == ')' -> {
                        depth--
                        if (depth == 0) return i
                    }
                }
                i++
            }
            return text.length - 1
        }

        /** Parses the value of a `key = …` argument starting at [valueStart]. */
        fun parse(source: File, line: Int, text: String, valueStart: Int): KeyUse {
            var end = valueStart
            while (end < text.length && text[end] != '\n') end++
            val raw = text.substring(valueStart, end).trim()

            if (raw.isEmpty()) return KeyUse(source, line, KeyUse.Kind.UNPARSED, raw = raw)
            if (raw.startsWith("\"")) return KeyUse(source, line, KeyUse.Kind.LITERAL, raw = raw)
            if (!raw.startsWith("{")) return KeyUse(source, line, KeyUse.Kind.REFERENCE, raw = raw)

            val inner = raw.substringAfter("{").trimStart()
            val arrow = inner.indexOf("->")
            if (arrow < 0) return KeyUse(source, line, KeyUse.Kind.IMPLICIT_IT, body = inner, raw = raw)

            val params = inner.substring(0, arrow)
                .split(',')
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            return KeyUse(
                source = source,
                line = line,
                kind = KeyUse.Kind.LAMBDA,
                params = params,
                body = inner.substring(arrow + 2).trim(),
                raw = raw,
            )
        }

        fun collectKeyUses(root: File): List<KeyUse> =
            File(root, "src/main/java")
                .walkTopDown()
                .filter { it.isFile && it.extension == "kt" }
                .flatMap { file ->
                    val text = file.readText()
                    // Sequence.flatMap (not the Iterable one) — hence the Sequence
                    // returned by the inner map.
                    ITEM_CALL.findAll(text).flatMap { call ->
                        val windowEnd = callWindow(text, call.range.last)
                        val window = text.substring(call.range.last, windowEnd)
                        KEY_ARG.findAll(window).map { key ->
                            val valueStart = key.range.last + 1
                            parse(file, lineOf(text, call.range.last + valueStart), window, valueStart)
                        }
                    }
                }
                .toList()
    }

    /** A key use is unsafe unless the item's position reaches the key expression. */
    private fun KeyUse.isViolation(): Boolean = when (kind) {
        // Hand-assigned and reviewed where they are written.
        KeyUse.Kind.LITERAL -> false
        // `key = someReference` (e.g. `key = keyOf`): uniqueness is not visible here.
        KeyUse.Kind.REFERENCE -> true
        // `key = { it.id }` — the item itself, never unique.
        KeyUse.Kind.IMPLICIT_IT -> true
        // A value that could not be read on one line: fail closed so it is reviewed.
        KeyUse.Kind.UNPARSED -> true
        KeyUse.Kind.LAMBDA -> {
            val position = params.firstOrNull()
            when {
                position == null -> true
                position == "_" -> true
                !INDEX_LIKE.matches(position) -> true
                // The position must actually reach the key, not just be declared.
                else -> !Regex("""\b${Regex.escape(position)}\b""").containsMatchIn(body)
            }
        }
    }

    @Test
    fun `every lazy list key is unique by construction`() {
        val moduleRoot = moduleRoot()
        val uses = collectKeyUses(moduleRoot)

        assertTrue("no `key = …` usages found — the scanner is broken", uses.isNotEmpty())

        val violations = uses.filter { it.isViolation() }

        assertEquals(
            buildString {
                appendLine("Lazy list keys must be position-prefixed so they cannot collide.")
                appendLine("Offenders:")
                violations.forEach { appendLine("  ${it.source.name}:${it.line}  ${it.raw}") }
                appendLine()
                appendLine("Use `itemsIndexed(list, key = { i, item -> \"\$i:\${item.id}\" })` or")
                appendLine("`items(list.size, key = { i -> \"\$i:\${list[i].id}\" })`.")
            },
            emptyList<KeyUse>(),
            violations,
        )
    }

    /**
     * Proves the scanner rejects the shapes that caused the real crash and accepts
     * the convention, so a later refactor cannot silently turn this into a no-op.
     */
    @Test
    fun `the scanner rejects non-positional keys and accepts positional ones`() {
        val probe = File("probe.kt")

        fun classify(snippet: String): Boolean {
            val call = ITEM_CALL.find(snippet) ?: error("no lazy item call in: $snippet")
            val window = snippet.substring(call.range.last)
            val key = KEY_ARG.find(window) ?: error("no `key =` in: $snippet")
            return parse(probe, 1, window, key.range.last + 1).isViolation()
        }

        // The exact field crash, its sibling in HomeContent, and the other shapes
        // the audit turned up.
        listOf(
            "items(categories, key = { it.name }) { }",
            """itemsIndexed(items = channels, key = { _, channel -> channel.id }) { }""",
            "items(items, key = keyOf) { }",
            "items(rows, key = { row -> row.channelId }) { }",
            """itemsIndexed(items = categoryEntries, key = { _, entry -> "category_${'$'}{entry.key}" }) { }""",
        ).forEach { snippet ->
            assertTrue("should have been rejected: $snippet", classify(snippet))
        }

        listOf(
            """itemsIndexed(items = categories, key = { i, name -> "${'$'}i:${'$'}name" }) { }""",
            """items(list.size, key = { i -> "${'$'}i:${'$'}{list[i].id}" }) { }""",
            """item(key = "portal") { }""",
        ).forEach { snippet ->
            assertTrue("should have been accepted: $snippet", !classify(snippet))
        }

        // A data-class argument is not a lazy key and must not be flagged.
        assertTrue(
            "constructor arguments must be ignored",
            ITEM_CALL.find("CatalogPosterItem(key = it.id, title = it.title)") == null,
        )
    }

    private fun moduleRoot(): File {
        var dir = File(System.getProperty("user.dir")).absoluteFile
        while (!File(dir, "src/main/java").isDirectory) {
            dir = dir.parentFile ?: error("could not locate the app module from user.dir")
        }
        return dir
    }
}
