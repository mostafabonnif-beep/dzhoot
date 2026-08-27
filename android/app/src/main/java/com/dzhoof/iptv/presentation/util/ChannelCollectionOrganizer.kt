package com.dzhoof.iptv.presentation.util

import com.dzhoof.iptv.presentation.model.ChannelUiModel
import java.util.Locale

/**
 * Curated, client-side channel collections.
 *
 * Providers use inconsistent group names and usually omit country metadata for
 * M3U/Xtream sources. This organizer preserves those raw groups in Room but
 * derives a stable browse layer from name + raw group + optional country. The
 * virtual keys are only used by the UI and are never sent back to the provider.
 */
data class ChannelCollection(
    val id: String,
    val title: String,
    val visualCategory: String,
    val channelCount: Int
)

object ChannelCollectionOrganizer {
    private const val PREFIX = "collection:"

    const val BEIN_SPORTS_ID = "collection:brand:bein-sports"
    const val SPORTS_ID = "collection:genre:sports"
    const val NEWS_ID = "collection:genre:news"
    const val MOVIES_ID = "collection:genre:movies"
    const val SERIES_ID = "collection:genre:series"
    const val KIDS_ID = "collection:genre:kids"
    const val DOCUMENTARY_ID = "collection:genre:documentary"
    const val MUSIC_ID = "collection:genre:music"

    private data class Definition(
        val id: String,
        val title: String,
        val visualCategory: String,
        val matches: (String) -> Boolean
    )

    private data class CountryRule(
        val id: String,
        val title: String,
        val tokens: List<String>
    ) {
        val normalizedTokens: List<String> = tokens.map(::normalizeSearchText)
    }

    private val countryRules = listOf(
        CountryRule("country:dz", "القنوات الجزائرية", listOf("ALGERIA", "ALGERIE", "DZ", "الجزائر", "جزائرية")),
        CountryRule("country:ma", "القنوات المغربية", listOf("MOROCCO", "MAROC", "MA", "المغرب", "مغربية")),
        CountryRule("country:tn", "القنوات التونسية", listOf("TUNISIA", "TN", "تونس", "تونسية")),
        CountryRule("country:eg", "القنوات المصرية", listOf("EGYPT", "EG", "مصر", "مصرية")),
        CountryRule("country:sa", "القنوات السعودية", listOf("SAUDI", "KSA", "SA", "السعودية", "سعودية")),
        CountryRule("country:ae", "القنوات الإماراتية", listOf("UAE", "EMIRATES", "AE", "الإمارات", "إماراتية")),
        CountryRule("country:qa", "القنوات القطرية", listOf("QATAR", "QA", "قطر", "قطرية")),
        CountryRule("country:kw", "القنوات الكويتية", listOf("KUWAIT", "KW", "الكويت", "كويتية")),
        CountryRule("country:lb", "القنوات اللبنانية", listOf("LEBANON", "LB", "لبنان", "لبنانية")),
        CountryRule("country:jo", "القنوات الأردنية", listOf("JORDAN", "JO", "الأردن", "أردنية")),
        CountryRule("country:tr", "القنوات التركية", listOf("TURKEY", "TURKISH", "TR", "تركيا", "تركية")),
        CountryRule("country:fr", "القنوات الفرنسية", listOf("FRANCE", "FRENCH", "FR", "فرنسا", "فرنسية")),
        CountryRule("country:uk", "القنوات البريطانية", listOf("UNITED KINGDOM", "BRITISH", "UK", "بريطانيا", "بريطانية")),
        CountryRule("country:us", "القنوات الأمريكية", listOf("UNITED STATES", "USA", "US", "AMERICAN", "أمريكا", "أمريكية")),
        CountryRule("country:de", "القنوات الألمانية", listOf("GERMANY", "GERMAN", "DE", "ألمانيا", "ألمانية")),
        CountryRule("country:it", "القنوات الإيطالية", listOf("ITALY", "ITALIAN", "IT", "إيطاليا", "إيطالية")),
        CountryRule("country:es", "القنوات الإسبانية", listOf("SPAIN", "SPANISH", "ES", "إسبانيا", "إسبانية")),
        CountryRule("country:pt", "القنوات البرتغالية", listOf("PORTUGAL", "PORTUGUESE", "PT", "البرتغال", "برتغالية")),
        CountryRule("country:br", "القنوات البرازيلية", listOf("BRAZIL", "BRAZILIAN", "BR", "البرازيل", "برازيلية")),
        CountryRule("country:in", "القنوات الهندية", listOf("INDIA", "INDIAN", "IN", "الهند", "هندية")),
        CountryRule("country:pk", "القنوات الباكستانية", listOf("PAKISTAN", "PAKISTANI", "PK", "باكستان", "باكستانية"))
    )

    private val definitions: List<Definition> = buildList {
        add(
            Definition(BEIN_SPORTS_ID, "beIN SPORTS", "sports") { text ->
                text.contains("BEIN") || text.contains("beIN", ignoreCase = true)
            }
        )
        add(Definition(SPORTS_ID, "القنوات الرياضية", "sports") { containsAny(it, sportTokens) })
        add(Definition(NEWS_ID, "الأخبار", "news") { containsAny(it, newsTokens) })
        add(Definition(MOVIES_ID, "الأفلام", "movies") { containsAny(it, movieTokens) })
        add(Definition(SERIES_ID, "المسلسلات", "series") { containsAny(it, seriesTokens) })
        add(Definition(KIDS_ID, "الأطفال", "kids") { containsAny(it, kidsTokens) })
        add(Definition(DOCUMENTARY_ID, "الوثائقيات", "documentary") { containsAny(it, documentaryTokens) })
        add(Definition(MUSIC_ID, "الموسيقى والراديو", "music") { containsAny(it, musicTokens) })
        countryRules.forEach { country ->
            add(
                Definition(
                    id = "$PREFIX${country.id}",
                    title = country.title,
                    visualCategory = "general"
                ) { text -> containsAny(text, country.normalizedTokens) }
            )
        }
    }

    /** Returns the established virtual browse collections that have live channels. */
    fun collections(channels: List<ChannelUiModel>): List<ChannelCollection> {
        // A playlist can contain several thousand channels. The original draft
        // repeatedly normalized every channel for every collection, which risks
        // allocating excessive short-lived strings immediately after splash.
        // Normalize each channel once and tally all definitions in the same pass.
        val counts = IntArray(definitions.size)
        channels.forEach { channel ->
            val text = searchableText(channel)
            definitions.forEachIndexed { index, definition ->
                if (definition.matches(text)) counts[index]++
            }
        }
        return definitions.mapIndexedNotNull { index, definition ->
            val count = counts[index]
            definition.takeIf { count > 0 }?.let {
                ChannelCollection(
                    id = definition.id,
                    title = definition.title,
                    visualCategory = definition.visualCategory,
                    channelCount = count
                )
            }
        }
    }

    fun isCollectionId(value: String?): Boolean = value?.startsWith(PREFIX) == true

    fun titleFor(collectionId: String?): String? =
        collectionId?.let { id -> definitions.firstOrNull { it.id == id }?.title }

    fun visualCategoryFor(collectionId: String?): String? =
        collectionId?.let { id -> definitions.firstOrNull { it.id == id }?.visualCategory }

    fun filter(channels: List<ChannelUiModel>, collectionId: String): List<ChannelUiModel> {
        val definition = definitions.firstOrNull { it.id == collectionId } ?: return emptyList()
        return channels.filter { channel -> definition.matches(searchableText(channel)) }
    }

    /** Used by persistence-backed favourites without requiring a UI model conversion. */
    fun matchesRaw(
        name: String,
        category: String,
        country: String?,
        collectionId: String
    ): Boolean {
        val definition = definitions.firstOrNull { it.id == collectionId } ?: return false
        return definition.matches(searchableText(name, category, country))
    }

    private fun searchableText(channel: ChannelUiModel): String =
        searchableText(channel.name, channel.category, channel.country)

    private fun searchableText(name: String, category: String, country: String?): String =
        normalizeSearchText("$name $category ${country.orEmpty()}")

    private fun containsAny(text: String, normalizedTokens: List<String>): Boolean {
        // Country codes such as FR or DZ must only match an independent word,
        // never an accidental substring inside a channel name such as "Fresh".
        val paddedText = " $text "
        return normalizedTokens.any { token ->
            if (token.length <= 2) paddedText.contains(" $token ") else text.contains(token)
        }
    }

    private fun normalizeSearchText(value: String): String {
        val result = StringBuilder(value.length)
        var needsSpace = false
        value.uppercase(Locale.ROOT).forEach { char ->
            if (char.isLetterOrDigit()) {
                if (needsSpace && result.isNotEmpty()) result.append(' ')
                result.append(char)
                needsSpace = false
            } else if (result.isNotEmpty()) {
                needsSpace = true
            }
        }
        return result.toString()
    }

    private fun normalizedTokens(tokens: List<String>): List<String> = tokens.map(::normalizeSearchText)

    private val sportTokens = normalizedTokens(listOf(
        "SPORT", "SPORTS", "FOOTBALL", "SOCCER", "NBA", "F1", "UFC", "رياضة", "رياضية", "كرة القدم"
    ))
    private val newsTokens = normalizedTokens(listOf("NEWS", "INFO", "CNN", "BBC", "AL JAZEERA", "FRANCE 24", "أخبار", "إخبارية"))
    private val movieTokens = normalizedTokens(listOf("MOVIE", "MOVIES", "CINEMA", "FILM", "أفلام", "سينما"))
    private val seriesTokens = normalizedTokens(listOf("SERIES", "DRAMA", "SHOW", "مسلسلات", "دراما"))
    private val kidsTokens = normalizedTokens(listOf("KIDS", "KID", "CHILD", "CARTOON", "ANIME", "أطفال", "كرتون"))
    private val documentaryTokens = normalizedTokens(listOf("DOCUMENT", "NATURE", "DISCOVERY", "ANIMAL", "وثائقي", "طبيعة"))
    private val musicTokens = normalizedTokens(listOf("MUSIC", "RADIO", "MTV", "موسيقى", "راديو"))
}
