# مسبح ترحيل المدن (Relay Pool) — وهران / الجزائر / جيجل

> هدفه: إزالة نقطة الفشل الوحيدة في الوصول إلى الـUpstream. ثلاثة حواسيب منزلية
> في ثلاث ولايات، كل واحد على خط إنترنت مختلف، يفتح كل منها نفق SSH عكسي إلى
> الـVPS. موزّع ذكي على الخادم يختار أفضل مدينة حية ويحوّل تلقائياً عند السقوط.

## البنية

```
حاسوب وهران   ─ ssh -R 9101 ─┐
حاسوب الجزائر ─ ssh -R 9102 ─┼─► relay-pool.py (VPS, 127.0.0.1:9000)
حاسوب جيجل    ─ ssh -R 9103 ─┘        │
                                      ▼
                            redsocks 0.0.0.0:12345 ← iptables (بدون تغيير)
                                      ▼
                                  Upstream
```

- `ssh -R <port>` الحديث يعطي SOCKS5 عكسي مباشرة من sshd — لا برمجة على الحواسيب.
- المنفذ 9000 لم يتغير: redsocks وiptables وupstream-relay.timer يعملون كما هم.
- النفق المنزلي القديم (relay.py) يبقى يعمل حتى تتصل المدن؛ الـpool يأخذ 9000
  فور تحرره (SO_REUSE + إعادة محاولة كل 5 ثوانٍ).

## القرارات

- **فحص صحي كل 15 ثانية** لكل مدينة عبر نفقها نحو الـUpstream (104.18.22.66:443).
- **موت**: فشلان متتاليان (≈30 ثانية). **تعافٍ**: نجاحان متتاليان.
- **النشط**: أعلى أولوية حية؛ التصاق بالنشط الحالي عند تساوي الأولوية (لا رفرفة).
- **كل المدن ميتة** ⇒ يغلق الـpool المستمع على 9000 ⇒ يزيل timer قواعد iptables
  ⇒ يرجع النظام للوضع المباشر (نفس سلوك "النفق مغلق" سابقاً). عند عودة أي مدينة
  يفتح تلقائياً خلال ثوانٍ.
- أولويات مبدئية: وهران(1) ← الجزائر(2) ← جيجل(3) — عدّلها في الإعداد حسب جودة الخطوط.

## ملفات الـVPS

| المسار | الدور |
|---|---|
| `/opt/dzhoof/relay/relay-pool.py` | الموزّع (stdlib فقط) |
| `/etc/dzhoof/relay-pool.json` | الإعداد (العقد، الأولويات، الفحص) |
| `/etc/systemd/system/dzhoof-relay-pool.service` | الخدمة (enabled) |
| `/etc/ssh/sshd_config.d/60-dzhoof-relay.conf` | قيود مستخدم الأنفاق |
| `/home/dzhoof-relay/.ssh/authorized_keys` | مفاتيح المدن الثلاث |
| `/var/lib/dzhoof-relay/status.json` | الحالة الحية (JSON) |

مستخدم `dzhoof-relay`: بلا shell، بلا PTY، forwarding عن بعد فقط
(`AllowTcpForwarding remote`). كل مفتاح يفتح منفذ مدينته فقط.

## المراقبة

```bash
curl -s http://127.0.0.1:9080/ | jq .        # حالة فورية
sudo journalctl -u dzhoof-relay-pool -f      # سجل حي (RECOVERED/DEAD/failover)
sudo docker exec dzhoof-redis redis-cli GET dzhoof:relay:pool   # نسخة Redis
```

## تثبيت حاسوب مدينة جديد

1. ولّد مفتاحاً: `ssh-keygen -t ed25519 -N "" -C dzhoof-relay-<city> -f <city>`
2. أضف `<city>.pub` إلى `authorized_keys` على الـVPS.
3. أضف العقدة في `/etc/dzhoof/relay-pool.json` ثم `sudo systemctl restart dzhoof-relay-pool`.
4. على الحاسوب (Windows): شغّل حزمة `dzhoof-relay-node-<city>.zip` ← install.bat
   كمسؤول (يثبّت WSL + خدمة نفق تلقائية).

## سلامة الإنتاج

- الـpool لا يلمس iptables/redsocks/Caddy/الحاويات.
- إعادة تشغيله آمنة: عند توقفه يتحرر 9000 فيأخذه النفق القديم إن كان متصلاً.
- الاتصالات الجارية عبر مدينة تموت إن ماتت (طبيعة SOCKS/TCP)؛ العميل يعيد
  المحاولة فيأخذ المدينة الجديدة — نفس سلوك سقوط النفق القديم.
