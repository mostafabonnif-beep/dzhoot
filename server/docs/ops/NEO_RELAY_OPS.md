# Upstream Relay — تشغيل وتشخيص (موثق 2026-08-19)

## البنية العاملة

```
التطبيق/الخادم → iptables REDIRECT → redsocks (0.0.0.0:12345)
              → SOCKS5 127.0.0.1:9000 → SSH reverse tunnel
              → relay.py على جهازك المنزلي (127.0.0.1:9001)
              → IP منزلك → Upstream (cf.upstream-host-redacted)
```

## مكونات جانب السيرفر (مثبتة وتعمل)

| المكوّن | الحالة/الملاحظة |
|---|---|
| `redsocks` | systemd، يستمع **0.0.0.0:12345** (وليس 127.0.0.1 — ضروري لحاويات Docker لأن REDIRECT يوجهها إلى IP الجسر) |
| `upstream-relay.timer` | كل دقيقتين: إذا استمع المنفذ 9000 → يفعّل قواعد iptables (OUTPUT + PREROUTING لعنواني 104.18.22.66/23.66:443 → 12345)، وإلا يزيلها |
| `upstream-routes.timer` | إدارة مسارات WireGuard (اختياري) |
| UFW | قاعدة إضافية: `allow from 172.16.0.0/12 to any port 12345 proto tcp` |
| الحاويات | `NODE_OPTIONS=--max-old-space-size=1024 --dns-result-order=ipv4first` — **ipv4first إجباري**: Upstream يحل إلى Cloudflare IPv6 (2606:4700::) التي لا تغطيها قواعد التوجيه، وبدون ipv4first يتجاوز البث التوجيه ويُحظر بـ 456 |

## جهة المنزل (المستخدم)

- `relay.py` يستمع على 127.0.0.1:9001 (SOCKS5 بسيط، مكتبة قياسية فقط)
- النفق: `ssh -N -R 127.0.0.1:9000:127.0.0.1:9001 root@5.135.79.221 -i relay_key`
- حزمة جاهزة: `upstream-home-relay-package.zip` (سكربتات Linux/macOS/Windows)
- أبقِ النافذة مفتوحة أثناء الاستخدام

## حقائق تشخيصية (من الفحص الحي 2026-08-19)

- `player_api.php` يعمل من الداتاسنتر مباشرة (بدون حظر) — auth=1
- بث `/live/...m3u8` من الداتاسنتر → **456** (محظور) — يتطلب العبور
- عبر العبور: `/live/...m3u8` → **302** إلى CDN (`*.ip1-neo50.me`) → **200 + قائمة HLS حية**
- **مقاطع CDN تُجلب مباشرة (200)** بدون عبور — لا حاجة لتغطيتها بالتوجيه
- فحص البث الحي في التطبيق (playback-token → proxy): **200، #EXTM3U، MEDIA-SEQUENCE متقدم (بث LIVE)**
- `xtream-sync` الكامل عبر العبور: **completed في ~95 ثانية**

## ملاحظات

- عنوانا Cloudflare (104.18.22.66/23.66) ثابتان حاليًا في DNS — إن تغيّرا، حدّث `UPSTREAM_IPS` في `/opt/dzhoot/upstream-relay-manage.sh`.
- المصدر "Primary Upstream" Active + verified — المزامنة المجدولة كل 6 ساعات.
- مصدر القنوات في التطبيق يعمل عبر نفس المسار (بروكسي الخادم يمر بالعبور).
