# سكربتات تشغيل DZ1 TV (بيئة تشارك خادم DZ HOOF)

- `ensure-dz1tv-caddy-net.sh` — يضمن بقاء `dzhoof-caddy` مربوطاً بشبكة `dz1-tv-internal`
  (يمنع 502 لموقع dz1tv.ld-11.net بعد إعادة إنشاء Caddy). على الخادم: systemd timer كل 60 ثانية.
- `dz1tv-watchdog.sh` — يفحص `dz1tv.ld-11.net/readyz` و`iptv.ld-11.net/health` كل 5 دقائق
  (cron) ويسجّل تغيّر الحالة في /var/log/dz1tv-watchdog.log ويعالج ذاتياً.
- `dz1tv-mongo-backup` — نسخ احتياطي يومي لقاعدة `dz1-tv` (cron 03:45، احتفاظ 14 يوماً، بصمة SHA256)
  في /opt/dz1-tv/backups.

التركيب على الخادم: انسخ إلى `/usr/local/sbin/` ثم فعّل cron/systemd (انظر تعليقات الملفات).
