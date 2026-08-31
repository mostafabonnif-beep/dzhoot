package com.dzhoof.iptv.presentation.util

import java.util.Locale

/**
 * يحوّل أسماء مجموعات Xtream الخام (مثل "AFR| AFRICA ⱽᴵᴾ ᴴᴰ/ᴿᴬᵂ" أو "AR| KIDS")
 * إلى أسماء تصنيفات عربية نظيفة واحترافية، مع مفتاح موحّد للأيقونات والألوان.
 *
 * - [localize] للعرض (اسم عربي جميل)
 * - [iconKey] للتلوين والأيقونات (kids / sports / news / ... أو general)
 *
 * ملاحظة أداء: آلاف القنوات تشترك في نفس أسماء المجموعات، فالنتائج مخزنة في
 * كاش ذاكرة (ConcurrentHashMap) — الترجمة تتم مرة واحدة لكل اسم فريد.
 */
object CategoryLocalizer {

    private val localizeCache = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val iconKeyCache = java.util.concurrent.ConcurrentHashMap<String, String>()

    /** اسم عرض عربي نظيف (بنية مخزنة). */
    fun localize(raw: String): String =
        localizeCache.getOrPut(raw) { localizeSlow(raw) }

    /** مفتاح موحّد للأيقونات والألوان (بنية مخزنة). */
    fun iconKey(raw: String): String =
        iconKeyCache.getOrPut(raw) { iconKeySlow(raw) }

    private fun localizeSlow(raw: String): String {
        val cleaned = clean(raw)
        if (cleaned.isBlank()) return "أخرى"

        // 1) كلمة النوع (أطفال/رياضة/أخبار...) لها الأولوية
        genreMatch(cleaned)?.let { return it.first }

        // 2) اسم دولة مذكور في النص (الجزائر، ALGERIA، TURKEY...)
        countryInText(cleaned)?.let { return it }

        // 3) بادئة البلد قبل "|" (مثل AFR|)
        prefixCountry(cleaned)?.let { return it }

        // 4) النص المنظف كما هو
        return cleaned
    }

    private fun iconKeySlow(raw: String): String {
        val cleaned = clean(raw)
        genreMatch(cleaned)?.let { return it.second }
        if (countryInText(cleaned) != null || prefixCountry(cleaned) != null) return "general"
        return "general"
    }

    // ── أسماء دول/مناطق شائعة (تُبحث في النص نفسه أولًا) ─────────────
    private val COUNTRY_LABELS = listOf(
        "الجزائر" to "جزائرية", "ALGERIA" to "جزائرية", "DZ" to "جزائرية",
        "TURKEY" to "تركية", "تركيا" to "تركية", "TR" to "تركية",
        "FRANCE" to "فرنسية", "فرنسا" to "فرنسية", "FR" to "فرنسية",
        "AFRICA" to "أفريقية", "AFR" to "أفريقية",
        "UNITED KINGDOM" to "بريطانية", "UK" to "بريطانية",
        "UNITED STATES" to "أمريكية", "USA" to "أمريكية", "US" to "أمريكية",
        "ASIA" to "آسيوية", "INDIA" to "هندية", "IN" to "هندية",
        "PAKISTAN" to "باكستانية", "PK" to "باكستانية",
        "EGYPT" to "مصرية", "مصر" to "مصرية", "EG" to "مصرية",
        "MOROCCO" to "مغربية", "المغرب" to "مغربية", "MA" to "مغربية",
        "TUNISIA" to "تونسية", "تونس" to "تونسية", "TN" to "تونسية",
        "LIBYA" to "ليبية", "ليبيا" to "ليبية", "LY" to "ليبية",
        "SAUDI" to "سعودية", "السعودية" to "سعودية", "SA" to "سعودية",
        "UAE" to "إماراتية", "الإمارات" to "إماراتية", "AE" to "إماراتية",
        "QATAR" to "قطرية", "قطر" to "قطرية", "QA" to "قطرية",
        "KUWAIT" to "كويتية", "KW" to "كويتية",
        "JORDAN" to "أردنية", "JO" to "أردنية",
        "LEBANON" to "لبنانية", "LB" to "لبنانية",
        "SYRIA" to "سورية", "SY" to "سورية",
        "IRAN" to "إيرانية", "IR" to "إيرانية",
        "RUSSIA" to "روسية", "RU" to "روسية",
        "CHINA" to "صينية", "CN" to "صينية",
        "JAPAN" to "يابانية", "JP" to "يابانية",
        "KOREA" to "كورية", "KR" to "كورية",
        "GERMANY" to "ألمانية", "ألمانيا" to "ألمانية", "DE" to "ألمانية",
        "SPAIN" to "إسبانية", "إسبانيا" to "إسبانية", "ES" to "إسبانية",
        "ITALY" to "إيطالية", "إيطاليا" to "إيطالية", "IT" to "إيطالية",
        "GREECE" to "يونانية", "GR" to "يونانية",
        "PORTUGAL" to "برتغالية", "PT" to "برتغالية",
        "BRAZIL" to "برازيلية", "BR" to "برازيلية",
        "MEXICO" to "مكسيكية", "MX" to "مكسيكية",
        "CANADA" to "كندية", "CA" to "كندية",
        "AUSTRALIA" to "أسترالية", "AU" to "أسترالية",
        "NETHERLANDS" to "هولندية", "NL" to "هولندية",
        "BELGIUM" to "بلجيكية", "BE" to "بلجيكية",
        "SWITZERLAND" to "سويسرية", "CH" to "سويسرية",
        "SWEDEN" to "سويدية", "SE" to "سويدية",
        "NORWAY" to "نرويجية", "NO" to "نرويجية",
        "DENMARK" to "دنماركية", "DK" to "دنماركية",
        "FINLAND" to "فنلندية", "FI" to "فنلندية",
        "POLAND" to "بولندية", "PL" to "بولندية",
        "CZECH" to "تشيكية", "CZ" to "تشيكية",
        "ROMANIA" to "رومانية", "RO" to "رومانية",
        "HUNGARY" to "مجرية", "HU" to "مجرية",
        "BULGARIA" to "بلغارية", "BG" to "بلغارية",
        "SERBIA" to "صربية", "RS" to "صربية",
        "CROATIA" to "كرواتية", "HR" to "كرواتية",
        "UKRAINE" to "أوكرانية", "UA" to "أوكرانية",
        "THAILAND" to "تايلندية", "TH" to "تايلندية",
        "INDONESIA" to "إندونيسية", "ID" to "إندونيسية",
        "MALAYSIA" to "ماليزية", "MY" to "ماليزية",
        "SINGAPORE" to "سنغافورية", "SG" to "سنغافورية",
        "PHILIPPINES" to "فلبينية", "PH" to "فلبينية",
        "VIETNAM" to "فيتنامية", "VN" to "فيتنامية",
        "AFGHAN" to "أفغانية", "AF" to "أفغانية",
        "ALBAN" to "ألبانية", "AL" to "ألبانية",
        "ISRAEL" to "عبرية", "HEBREW" to "عبرية", "IL" to "عبرية",
        "IRAQ" to "عراقية", "العراق" to "عراقية", "IQ" to "عراقية",
        "YEMEN" to "يمنية", "اليمن" to "يمنية", "YE" to "يمنية",
        "SUDAN" to "سودانية", "السودان" to "سودانية", "SD" to "سودانية",
        "PALESTINE" to "فلسطينية", "فلسطين" to "فلسطينية", "PS" to "فلسطينية",
        "OMAN" to "عمانية", "عمان" to "عمانية", "OM" to "عمانية",
        "BAHRAIN" to "بحرينية", "البحرين" to "بحرينية", "BH" to "بحرينية",
        "MAURITANIA" to "موريتانية", "موريتانيا" to "موريتانية", "MR" to "موريتانية",
        "MAGHREB" to "مغاربية", "المغرب العربي" to "مغاربية",
        "LATIN" to "لاتينية", "LATAM" to "لاتينية",
        "EUROPE" to "أوروبية", "EU" to "أوروبية",
        "INTERNATIONAL" to "عالمية", "INT" to "عالمية",
        "WORLD" to "عالمية",
    )

    // ── كلمات النوع: مفتاح (إنجليزي/عربي) → (اسم عربي، iconKey) ──────
    private val GENRE_RULES = listOf(
        listOf("KIDS", "CHILD", "CARTOON", "TOON", "CARTOONS", "أطفال", "اطفال", "كارتون") to ("أطفال" to "kids"),
        listOf("SPORT", "FOOTBALL", "SOCCER", "رياضة", "رياضي") to ("رياضة" to "sports"),
        listOf("NEWS", "أخبار", "إخبارية") to ("أخبار" to "news"),
        listOf("MOVIE", "CINEMA", "FILM", "أفلام", "سينما") to ("أفلام" to "movies"),
        listOf("SERIES", "DRAMA", "مسلسلات", "دراما") to ("مسلسلات" to "series"),
        listOf("MUSIC", "AGAMI", "أغاني", "موسيقى", "غناء") to ("موسيقى" to "music"),
        listOf("DOCUMENT", "SCIENCE", "وثائقي", "علمي") to ("وثائقي" to "documentary"),
        listOf("RELIG", "ISLAM", "QURAN", "دينية", "ديني", "إسلامية") to ("دينية" to "religious"),
        listOf("GENERAL", "VARIETY", "منوعات", "عامة") to ("عامة" to "general"),
        listOf("ENTERTAIN", "COMEDY", "TALK", "FOOD", "COOK", "ترفيه", "كوميديا", "طبخ") to ("ترفيه" to "entertainment"),
        listOf("ANIMAL", "NATURE", "طبيعة", "حيوانات") to ("طبيعة" to "documentary"),
        listOf("RADIO", "راديو") to ("راديو" to "music"),
        listOf("24/7", "24H") to ("24/7" to "general"),
        listOf("LIVE", "مباشر") to ("مباشر" to "general"),
        listOf("XXX", "ADULT") to ("للبالغين" to "xxx"),
    )

    private fun clean(raw: String): String {
        // احتفظ بالحروف (عربي/لاتيني) والأرقام والمسافات وبعض الرموز،
        // واحذف رموز التزيين (ᴴᴰ ⱽᴵᴾ ▸ ▶ ...)
        val cleaned = raw
            .map { c ->
                if (c.isLetterOrDigit() || c.isWhitespace() || c in "|&/.,()-") c else ' '
            }
            .joinToString("")
            .replace(Regex("\\s+"), " ")
            .trim()
        return cleaned
    }

    private fun genreMatch(cleaned: String): Pair<String, String>? {
        val upper = cleaned.uppercase(Locale.ROOT)
        for ((keywords, pair) in GENRE_RULES) {
            if (keywords.any { upper.contains(it) }) return pair
        }
        return null
    }

    private fun countryInText(cleaned: String): String? {
        val upper = cleaned.uppercase(Locale.ROOT)
        for ((token, label) in COUNTRY_LABELS) {
            if (upper.contains(token)) return label
        }
        return null
    }

    private fun prefixCountry(cleaned: String): String? {
        val prefix = cleaned.substringBefore('|').trim().uppercase(Locale.ROOT)
        if (prefix.isEmpty()) return null
        for ((token, label) in COUNTRY_LABELS) {
            if (token == prefix || token == prefix.substringBefore(' ')) return label
        }
        return null
    }
}
