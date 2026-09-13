# الاتجاه D — البوابة الأفقية (Landscape Portal) · 2026-09-13

## القرار

التطبيق **أفقي دائماً**، والشاشة الافتتاحية هي **البوابة**، والهوية **أسود × ذهبي**:

| العنصر | القيمة |
|---|---|
| الاتجاه | `android:screenOrientation="sensorLandscape"` على `ComposeMainActivity` |
| لون الفعل | `ActionPrimary` = `DzGold400 #E7BD62` |
| الحبر على الذهبي | `ActionOnPrimary` = `Ink950 #050B08` |
| الخلفية / السطح | `Atlas950 #070A09` / `Atlas800 #121917` |
| البثّ الحيّ والصحة | `LiveAccent` = `DzGreen400 #10B981` (الأخضر لم يعد لون الفعل) |

## ما تغيّر في الكود

| الملف | التغيير |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | `android:screenOrientation="sensorLandscape"` على النشاط الرئيسي |
| `presentation/ui/screens/player/PlayerOrientation.kt` | `exitFullscreen()` يحرّر الاتجاه بدل فرض العمود |
| `ComposeMainActivity.kt` | `usePremiumTvChrome = !isPortrait` — شريط علوي واحد لكل الوضع الأفقي (اختفت الحاجة للشريط الجانبي والشريط السفلي) |
| `theme/Color.kt` | رموز دلالية جديدة: `ActionPrimary`, `ActionOnPrimary`, `ActionPrimaryDeep`, `LiveAccent` |
| `theme/Theme.kt` | `primary` في اللوحة الداكنة = `ActionPrimary` (ذهبي) |
| `screens/home/HomeContent.kt` | البوابة أصبحت القسم الأول في الرئيسية، والـHero بعدها، وبلاطة «مباشر» ذهبية |

## لماذا هذا التغيير صغير وأثره كبير

الشاشات تختار تخطيطها عبر `screenWidthDp < 600` (`isCompact`) و`isMobileDevice()`.
مع القفل الأفقي يصبح عرض الهاتف أكبر من 600dp، فيأخذ تلقائياً:

- **البوابة الواسعة** بدل صفّ البلاطات القابل للتمرير (`HomePortalTiles`).
- **ثلاث لوحات للبثّ المباشر** في `ChannelsScreen` بدل شبكة البطاقات (`LiveThreePane`).
- **شريط الحالة + QR** في تذييل البوابة (`portal_footer`).

أي أن القفل الأفقي + توحيد الشريط العلوي يعطيان بنية الاتجاه D بلا إعادة كتابة الشاشات.

## مرفقات بصرية

`docs/redesign-2026-09-13-shots/`:
`D1-portal-1920.jpg` (البوابة) · `D2-live-1920.jpg` (البثّ بثلاث لوحات) ·
`D3-phone-landscape.jpg` (نفس البنية على الهاتف بالعرض)، ومعها لوحات الجولات السابقة A/B/C.

## ملاحظات تنفيذ

1. **التنقّل:** مع إخفاء الشريط السفلي والجانبي، لم تعد مجموعة `phoneBottomNavItems` تُستخدم —
   تُترك للتوافق أو تُحذف في تنظيف لاحق.
2. **تخطيطات عمودية غير قابلة للوصول:** `PlayerPortraitLayout` / `PlayerPortraitTabs` /
   `BottomChannelPanel` العمودي تبقى في الكود بلا مسار وصول — تُنظَّف لاحقاً بدل حذفها الآن.
3. **reduce-motion:** لم تُضف أي حركة جديدة، والرموز الذهبية ثابتة (بلا ظلال متحركة).
4. **التحقق:** `assembleStagingDebug` + `testStagingDebugUnitTest` عبر CI نفسه.
