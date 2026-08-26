package com.dzhoof.iptv.presentation.ui.theme

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Article
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.ChildCare
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.FamilyRestroom
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material.icons.filled.Gavel
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Newspaper
import androidx.compose.material.icons.filled.Park
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Spa
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material.icons.filled.Theaters
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import com.dzhoof.iptv.presentation.util.CategoryLocalizer
import java.util.Locale

// ── DzGreen — brand primary (أخضر العلم الجزائري) ────────────────────
// Dark mode primary: DzGreen300. Light mode primary: DzGreen500.
val DzGreen300 = Color(0xFF34D399)   // bright emerald — dark mode primary, focus rings
val DzGreen400 = Color(0xFF10B981)   // emerald — button fills, active nav
val DzGreen500 = Color(0xFF059669)   // deep emerald — light mode primary, pressed
val DzGreen50  = Color(0xFFE8F7EF)   // tint — hover backgrounds, badge tints
val DzGreen100 = Color(0xFFA7F3D0)   // glow overlays, focus halos
val DzGreen700 = Color(0xFF065F46)   // text on green-colored surfaces

// ── DzRed — أحمر العلم الجزائري (للشارات الحية والتنبيهات فقط) ────────
val DzRed400 = Color(0xFFE0354F)     // bright red — live badges
val DzRed500 = Color(0xFFD21034)     // flag red — hearts, alerts, LIVE
val DzRed600 = Color(0xFFA50E2A)     // pressed red

// ── DzGold — لمسة فاخرة (نجمة وهلال، تمييزات) ────────────────────────
val DzGold300 = Color(0xFFF0D68A)
val DzGold400 = Color(0xFFE8C468)
val DzGold500 = Color(0xFFC9A44B)

// ── Backward-compatible aliases (deprecated — replaced by DzGreen) ───
@Deprecated("Replaced by DzGreen300", ReplaceWith("DzGreen300"))
val Flame300 = DzGreen300
@Deprecated("Replaced by DzGreen400", ReplaceWith("DzGreen400"))
val Flame400 = DzGreen400
@Deprecated("Replaced by DzGreen500", ReplaceWith("DzGreen500"))
val Flame500 = DzGreen500
@Deprecated("Replaced by DzGreen50", ReplaceWith("DzGreen50"))
val Flame50  = DzGreen50
@Deprecated("Replaced by DzGreen100", ReplaceWith("DzGreen100"))
val Flame100 = DzGreen100
@Deprecated("Replaced by DzGreen700", ReplaceWith("DzGreen700"))
val Flame700 = DzGreen700
@Deprecated("Replaced by DzGreen300", ReplaceWith("DzGreen300"))
val Amber      = DzGreen300
@Deprecated("Replaced by DzGreen100", ReplaceWith("DzGreen100"))
val AmberLight = DzGreen100
@Deprecated("Replaced by DzGreen500", ReplaceWith("DzGreen500"))
val AmberDark  = DzGreen500

// ── Atlas — dark mode surfaces (أخضر داكن عميق) ──────────────────────
val Atlas950 = Color(0xFF070D0A)    // app background
val Atlas900 = Color(0xFF0C1512)    // sidebar / navigation drawer
val Atlas800 = Color(0xFF111D17)    // card background
val Atlas700 = Color(0xFF16241D)    // elevated / focused card
val Atlas600 = Color(0xFF1D2E25)    // overlay, modal surface
val Atlas500 = Color(0xFF243A30)    // tooltip, highest elevation

// ── Backward-compatible aliases (deprecated — replaced by Atlas) ─────
@Deprecated("Replaced by Atlas950", ReplaceWith("Atlas950"))
val Void950 = Atlas950
@Deprecated("Replaced by Atlas900", ReplaceWith("Atlas900"))
val Void900 = Atlas900
@Deprecated("Replaced by Atlas800", ReplaceWith("Atlas800"))
val Void800 = Atlas800
@Deprecated("Replaced by Atlas700", ReplaceWith("Atlas700"))
val Void700 = Atlas700
@Deprecated("Replaced by Atlas600", ReplaceWith("Atlas600"))
val Void600 = Atlas600
@Deprecated("Replaced by Atlas500", ReplaceWith("Atlas500"))
val Void500 = Atlas500

// ── Backward-compatible aliases ──────────────────────────────────────
val BackgroundDark   = Atlas950
val BackgroundMedium = Atlas900
val SurfaceDark      = Atlas800
val SurfaceVariant   = Atlas700
val SurfaceElevated  = Atlas600

// ── Sand — light mode surfaces (فاتح بميل أخضر) ──────────────────────
val Sand50  = Color(0xFFF6F9F7)   // app background
val Sand100 = Color(0xFFECF2EE)   // content areas
val Sand200 = Color(0xFFE2EAE4)   // card background
val Sand300 = Color(0xFFD4DED7)   // borders, dividers
val Sand500 = Color(0xFFB4C2BA)   // strong borders
val Sand700 = Color(0xFF8A9B90)   // icons, inactive elements

// ── Backward-compatible aliases (deprecated — replaced by Sand) ──────
@Deprecated("Replaced by Sand50", ReplaceWith("Sand50"))
val Parchment50  = Sand50
@Deprecated("Replaced by Sand100", ReplaceWith("Sand100"))
val Parchment100 = Sand100
@Deprecated("Replaced by Sand200", ReplaceWith("Sand200"))
val Parchment200 = Sand200
@Deprecated("Replaced by Sand300", ReplaceWith("Sand300"))
val Parchment300 = Sand300
@Deprecated("Replaced by Sand500", ReplaceWith("Sand500"))
val Parchment500 = Sand500
@Deprecated("Replaced by Sand700", ReplaceWith("Sand700"))
val Parchment700 = Sand700

// ── Text — dark mode ─────────────────────────────────────────────────
val TextPrimaryDark   = Color(0xFFF2EDE3)
val TextSecondaryDark = Color(0xFFA5B8AE)
val TextDimDark       = Color(0xFF5E7469)
val TextDisabledDark  = Color(0xFF2E3A33)

// ── Text — light mode ────────────────────────────────────────────────
val TextPrimaryLight   = Color(0xFF14201A)
val TextSecondaryLight = Color(0xFF3E5A4C)
val TextDimLight       = Color(0xFF75887D)
val TextDisabledLight  = Color(0xFFB4C2BA)

// ── Backward-compatible aliases (resolves to dark defaults) ──────────
val TextPrimary   = TextPrimaryDark
val TextSecondary = TextSecondaryDark
val TextDim       = TextDimDark
val TextDisabled  = TextDisabledDark

// ── Warm highlight ───────────────────────────────────────────────────
val WarmHighlight = Sand100

// ── Semantic — dark mode ─────────────────────────────────────────────
val SuccessDark = Color(0xFF28B560)
val ErrorDark   = Color(0xFFE83838)
val WarningDark = Color(0xFFF5A624)
val InfoDark    = Color(0xFF3D88F5)

// ── Semantic — light mode ────────────────────────────────────────────
val SuccessLight = Color(0xFF1A8A40)
val ErrorLight   = Color(0xFFC02020)
val WarningLight = Color(0xFFD07808)
val InfoLight    = Color(0xFF1A60D0)

// ── Backward-compatible aliases ──────────────────────────────────────
val Success  = SuccessDark
val Error    = ErrorDark
val Warning  = WarningDark
val Info     = InfoDark
val SteelBlue      = InfoDark
val SteelBlueDark  = InfoLight
val SteelBlueLight = Color(0xFF7AAEF8)

// ── Channel health ───────────────────────────────────────────────────
val HealthOnline   = SuccessDark    // #28B560
val HealthChecking = WarningDark    // #F5A624
val HealthOffline  = ErrorDark      // #E83838
val HealthUnknown  = TextDimDark    // #5E7469

// ── Focus and selection (TV) ─────────────────────────────────────────
val FocusGlow        = Color(0x4034D399)   // 25% DzGreen300
val FocusBorder      = DzGreen300
val SelectionOverlay = Color(0x1AFFFFFF)

// ── Guide (EPG) focus ────────────────────────────────────────────────
val GuideRowWash        = Color(0x1F34D399)   // ~12% DzGreen300 — focused-row gradient wash
val GuideCellFocusStart = Color(0x5934D399)   // ~35% DzGreen300 — focused cell gradient start
val GuideCellFocusEnd   = Color(0x2610B981)   // ~15% DzGreen400 — focused cell gradient end
const val GuideLiveTintAlpha = 0.10f          // category tint behind currently-airing cells

// ── Borders ──────────────────────────────────────────────────────────
val SubtleBorderDark  = Color(0x10FFFFFF)   // ~6% white on dark surfaces
val SubtleBorderLight = Color(0x20000000)   // ~12% black on light surfaces
val SubtleBorder = SubtleBorderDark         // Backward compat — prefer subtleBorder() composable

// ── Standardized emphasis opacities ──────────────────────────────────
const val EmphasisHigh     = 0.87f
const val EmphasisMedium   = 0.6f
const val EmphasisDisabled = 0.38f

// ── Video overlay scrims ─────────────────────────────────────────────
// For player overlays and toasts rendered on top of video, where theme
// surfaces don't apply — always dark regardless of app theme.
val ScrimHeavy = Color(0xBF000000)          // 75% black — toasts, info panels
val ScrimLight = Color(0x99000000)          // 60% black — number chip, lighter overlays
val OnVideo    = Color(0xFFFFFFFF)          // text/icons on video scrims
val VideoOverlayBackground = ScrimHeavy

// ── Background gradient glows ────────────────────────────────────────
val DzGreenGlow    = Color(0x0A34D399)   // ~4% DzGreen300
@Deprecated("Replaced by DzGreenGlow", ReplaceWith("DzGreenGlow"))
val AmberGlow      = DzGreenGlow
val SteelBlueGlow  = Color(0x0A3D88F5)   // ~4% Info blue

// ── Category colors — muted tones for dark backgrounds ───────────────
// Based on iptv-org/database categories (29 categories)
val CategorySports        = Color(0xFF4CAF7A)
val CategoryNews          = Color(0xFF5B9BD5)
val CategoryMovies        = Color(0xFFC96B6B)
val CategoryEntertainment = Color(0xFF9B7EC8)
val CategoryMusic         = Color(0xFFD98A6E)
val CategoryKids          = Color(0xFF4DB6AC)
val CategoryDocumentary   = Color(0xFF7C9A82)
val CategoryGeneral       = DzGreen300
val CategoryAnimation = Color(0xFFE87ECB)
val CategoryBusiness = Color(0xFF6893B8)
val CategoryClassic = Color(0xFFA89078)
val CategoryComedy = Color(0xFFE8C84A)
val CategoryCooking = Color(0xFFE88A5A)
val CategoryCulture = Color(0xFF8B7EC8)
val CategoryEducation = Color(0xFF5AA8D5)
val CategoryFamily = Color(0xFF6AAFAC)
val CategoryInteractive = Color(0xFF7A8ED5)
val CategoryLegislative = Color(0xFF8A9AAE)
val CategoryLifestyle = Color(0xFFB87EC8)
val CategoryOutdoor = Color(0xFF6AAF6A)
val CategoryPublic = Color(0xFF7A96B8)
val CategoryRelax = Color(0xFF80C0A8)
val CategoryReligious = Color(0xFFC8A86A)
val CategorySeries = Color(0xFFAF6A8A)
val CategoryScience = Color(0xFF5AC8D5)
val CategoryShop = Color(0xFFD5A05A)
val CategoryTravel = Color(0xFF5AB8AF)
val CategoryWeather = Color(0xFF68B8E8)
val CategoryAuto = Color(0xFF8AAF6A)
val CategoryXxx = Color(0xFF8A6A6A)

fun categoryColor(category: String): Color = when (CategoryLocalizer.iconKey(category)) {
    "sports" -> CategorySports
    "news" -> CategoryNews
    "movies" -> CategoryMovies
    "entertainment" -> CategoryEntertainment
    "music" -> CategoryMusic
    "kids" -> CategoryKids
    "documentary" -> CategoryDocumentary
    "general" -> CategoryGeneral
    "animation" -> CategoryAnimation
    "business" -> CategoryBusiness
    "classic" -> CategoryClassic
    "comedy" -> CategoryComedy
    "cooking" -> CategoryCooking
    "culture" -> CategoryCulture
    "education" -> CategoryEducation
    "family" -> CategoryFamily
    "interactive" -> CategoryInteractive
    "legislative" -> CategoryLegislative
    "lifestyle" -> CategoryLifestyle
    "outdoor" -> CategoryOutdoor
    "public" -> CategoryPublic
    "relax" -> CategoryRelax
    "religious" -> CategoryReligious
    "series" -> CategorySeries
    "science" -> CategoryScience
    "shop" -> CategoryShop
    "travel" -> CategoryTravel
    "weather" -> CategoryWeather
    "auto" -> CategoryAuto
    "xxx" -> CategoryXxx
    else -> DzGreen300
}

fun categoryIcon(category: String): ImageVector = when (CategoryLocalizer.iconKey(category)) {
    "sports" -> Icons.Filled.SportsSoccer
    "news" -> Icons.Filled.Newspaper
    "movies" -> Icons.Filled.Movie
    "entertainment" -> Icons.Filled.Tv
    "music" -> Icons.Filled.MusicNote
    "kids" -> Icons.Filled.ChildCare
    "documentary" -> Icons.Filled.Article
    "general" -> Icons.Filled.LiveTv
    "animation" -> Icons.Filled.Movie
    "business" -> Icons.Filled.AccountBalance
    "classic" -> Icons.Filled.Theaters
    "comedy" -> Icons.Filled.EmojiEmotions
    "cooking" -> Icons.Filled.Restaurant
    "culture" -> Icons.Filled.AccountBalance
    "education" -> Icons.Filled.School
    "family" -> Icons.Filled.FamilyRestroom
    "interactive" -> Icons.Filled.SportsEsports
    "legislative" -> Icons.Filled.Gavel
    "lifestyle" -> Icons.Filled.SelfImprovement
    "outdoor" -> Icons.Filled.Park
    "public" -> Icons.Filled.Public
    "relax" -> Icons.Filled.Spa
    "religious" -> Icons.Filled.MenuBook
    "series" -> Icons.Filled.VideoLibrary
    "science" -> Icons.Filled.Science
    "shop" -> Icons.Filled.ShoppingCart
    "travel" -> Icons.Filled.Flight
    "weather" -> Icons.Filled.WbSunny
    "auto" -> Icons.Filled.DirectionsCar
    "xxx" -> Icons.Filled.Block
    else -> Icons.Filled.LiveTv
}
