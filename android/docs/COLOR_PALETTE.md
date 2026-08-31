# DZ HOOF — Color Palette Reference

> Unified design system shared with the DZ HOOF Server web app.
> Both apps use the same palette — الهوية الجزائرية: **DzGreen** (brand, أخضر العلم)، **Atlas** (dark surfaces)، **Sand** (light surfaces)، مع **DzRed** (أحمر العلم) و **DzGold** (لمسة فاخرة).

---

## Brand — DzGreen

Emerald green inspired by the Algerian flag. The single primary accent used for interactive elements, focus rings, and active states across both dark and light modes.

| Token         | Hex       | Usage                                       |
|---------------|-----------|---------------------------------------------|
| `dz-green-50` | `#E8F7EF` | Tint backgrounds, hover overlays            |
| `dz-green-100`| `#A7F3D0` | Glow effects, badge tints, highlight bg     |
| `dz-green-300`| `#34D399` | **Dark mode primary** — buttons, focus ring |
| `dz-green-400`| `#10B981` | Button fills, active nav items              |
| `dz-green-500`| `#059669` | **Light mode primary** — pressed states     |
| `dz-green-700`| `#065F46` | Text on green-colored backgrounds           |

### Kotlin constants (`Color.kt`)

```kotlin
val DzGreen300 = Color(0xFF34D399)   // dark mode primary
val DzGreen400 = Color(0xFF10B981)   // button fills
val DzGreen500 = Color(0xFF059669)   // light mode primary
val DzGreen50  = Color(0xFFE8F7EF)   // tint
val DzGreen100 = Color(0xFFA7F3D0)   // glow
val DzGreen700 = Color(0xFF065F46)   // on-green text
```

> ملاحظة: الأسماء القديمة `Flame*` / `Amber*` / `Void*` / `Parchment*` ما زالت موجودة كأسماء بديلة (deprecated aliases) في `Color.kt` و `colors.xml` لمنع كسر الكود — الرجاء استخدام أسماء DzGreen/Atlas/Sand في الكود الجديد.

---

## Accents — DzRed & DzGold

| Token     | Hex       | Usage                                        |
|-----------|-----------|----------------------------------------------|
| `dz-red-500`  | `#D21034` | أحمر العلم — LIVE badges, hearts, alerts (استخدام مقصود ومدروس) |
| `dz-red-400`  | `#E0354F` | Bright red — live dots, countdowns           |
| `dz-gold-300` | `#F0D68A` | لمسة فاخرة — ratings, highlights             |
| `dz-gold-400` | `#E8C468` | Gold accents (dark mode)                     |
| `dz-gold-500` | `#C9A44B` | Gold accents (light mode)                    |

---

## Dark Mode — Atlas

Deep green-black surfaces. الخضرة الخفيفة تعطي دفء الهوية الجزائرية مع بقاء التباين عاليًا.

| Token       | Hex       | Usage                                |
|-------------|-----------|--------------------------------------|
| `atlas-950` | `#070D0A` | App background                       |
| `atlas-900` | `#0C1512` | Sidebar / navigation drawer          |
| `atlas-800` | `#111D17` | Card background                      |
| `atlas-700` | `#16241D` | Elevated / focused card              |
| `atlas-600` | `#1D2E25` | Overlay, modal surface               |
| `atlas-500` | `#243A30` | Tooltip, highest elevation           |

## Light Mode — Sand

Warm off-white with a soft green tint.

| Token      | Hex       | Usage                           |
|------------|-----------|---------------------------------|
| `sand-50`  | `#F6F9F7` | App background                  |
| `sand-100` | `#ECF2EE` | Content areas                   |
| `sand-200` | `#E2EAE4` | Card background                 |
| `sand-300` | `#D4DED7` | Borders, dividers               |
| `sand-500` | `#B4C2BA` | Strong borders                  |
| `sand-700` | `#8A9B90` | Icons, inactive elements        |

---

## Typography

- **Display** — Noto Kufi Arabic (variable font, bundled) — geometric, premium TV look
- **Body** — Cairo (variable font, bundled) — clean, highly legible Arabic + Latin
- Bundled locally (not Downloadable Fonts) so the app renders on Fire TV / Android TV without Play Services.

---

## Focus / Selection (TV)

| Token                  | Value          | Usage                                 |
|------------------------|----------------|---------------------------------------|
| `focus-glow-outer`     | `#4034D399`    | 25% DzGreen300 — outer focus halo     |
| `focus-glow-inner`     | `#6034D399`    | 37% DzGreen300 — inner focus glow     |
| `focus-border-bright`  | `#34D399`      | Focus border (dark), `#059669` (light)|

## Semantic (status)

Kept independent of the brand palette — signals must stay instantly recognizable:

| Token          | Dark      | Light     |
|----------------|-----------|-----------|
| Success        | `#28B560` | `#1A8A40` |
| Error          | `#E83838` | `#C02020` |
| Warning        | `#F5A624` | `#D07808` |
| Info           | `#3D88F5` | `#1A60D0` |
| Live / ONLINE  | `#D21034` | `#D21034` |
