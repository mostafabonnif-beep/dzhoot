# DZ HOOF Server — Color Palette Reference

> Unified design system shared with the DZ HOOF Android app.
> Both apps use the same palette — الهوية الجزائرية: **DzGreen** (brand)، **Atlas** (dark surfaces)، **Sand** (light surfaces)، مع **DzRed** و **DzGold**.

---

## Brand — DzGreen

| Token          | Hex       | HSL (approx)   | Usage                                       |
| -------------- | --------- | -------------- | ------------------------------------------- |
| `dz-green-50`  | `#E8F7EF` | `152 76% 80%`  | Tint backgrounds, hover overlays            |
| `dz-green-100` | `#A7F3D0` | `152 76% 80%`  | Glow effects, badge tints                   |
| `dz-green-300` | `#34D399` | `158 65% 52%`  | **Dark mode primary** — buttons, focus ring |
| `dz-green-400` | `#10B981` | `160 84% 39%`  | Button fills, active nav                    |
| `dz-green-500` | `#059669` | `161 94% 30%`  | **Light mode primary** — pressed states     |
| `dz-green-700` | `#065F46` | `163 88% 20%`  | Text on green-colored backgrounds           |

### CSS Variables (`globals.css`)

```css
/* Light mode (:root) */
--primary: 161 94% 30%;          /* dz-green-500  #059669 */
--primary-foreground: 140 20% 97%; /* sand-50 on green */
--ring: 161 94% 30%;
--radius: 10px;                  /* rounded, modern */

/* Dark mode (.dark) */
--primary: 158 65% 52%;          /* dz-green-300  #34D399 */
--primary-foreground: 150 30% 4%; /* atlas-950 on green */
--ring: 158 65% 52%;
```

---

## Accents — DzRed & DzGold

| Token        | Hex       | HSL (approx)  | Usage                                        |
| ------------ | --------- | ------------- | -------------------------------------------- |
| `dz-red-500` | `#D21034` | `350 83% 44%` | أحمر العلم — LIVE, alerts (مقصور على الدلالة) |
| `dz-gold-400`| `#E8C468` | `43 74% 66%`  | لمسة فاخرة — brand-gradient end, highlights  |

---

## Surfaces

| Token (dark) | Hex       | Usage          | Token (light) | Hex       | Usage          |
| ------------ | --------- | -------------- | ------------- | --------- | -------------- |
| `atlas-950`  | `#070D0A` | App background | `sand-50`     | `#F6F9F7` | App background |
| `atlas-900`  | `#0C1512` | Sidebar        | `sand-100`    | `#ECF2EE` | Content areas  |
| `atlas-800`  | `#111D17` | Card           | `sand-200`    | `#E2EAE4` | Card           |
| `atlas-700`  | `#16241D` | Focused card   | `sand-300`    | `#D4DED7` | Borders        |
| `atlas-600`  | `#1D2E25` | Border/modal   | `sand-500`    | `#B4C2BA` | Strong borders |

---

## Typography

- **Display** — `Noto_Kufi_Arabic` (`--font-display`) — geometric, premium
- **Body** — `Cairo` (`--font-body`, arabic + latin subsets) — clean, legible
- Arabic fallback — `--font-arabic` → Noto Kufi Arabic

Loaded via `next/font/google` in `app/layout.tsx`.

---

## Semantic (status) — لا تُغيّر

Signals stay independent of brand: `--signal-green/red/blue/amber` unchanged.
Warning/amber states (expiring soon, debts, disable actions) intentionally remain amber.
