# DZ HOOF — SSH Hardening Plan (audit-remediation-v1)

> ⚠️ **لم يُنفَّذ أي تغيير على SSH بعد.** هذا الدليل + السكربت هما خطة معتمدة
> مسبقًا تُنفذ فقط بموافقة صريحة من المالك وبعد اختبار دخول بالمفتاح بنجاح.

## الوضع الحالي (من فحص 2026-08-19)

- `PermitRootLogin yes` مع دخول root بكلمة مرور.
- لا يوجد `fail2ban`.
- لا يوجد مستخدم sudo ثانٍ.
- كلمة مرور root وصلت نصًا في محادثة — يجب تدويرها.

## الخطة (بالترتيب الإجباري)

| الخطوة | الإجراء | متى |
|---|---|---|
| 1 | تشغيل `scripts/security/secure-ssh-setup.sh` على السيرفر | بموافقة المالك |
| 2 | نسخ المفتاح الخاص `dzhoof_ed25519` إلى جهازك المحلي `~/.ssh/` ثم `chmod 600` | بعد 1 |
| 3 | اختبار الدخول بالمفتاح: `ssh -i ~/.ssh/dzhoof_ed25519 dzhoof-admin@<IP>` | بعد 2 |
| 4 | تطبيق بنود `/etc/ssh/sshd_config` المطبوعة من السكربت + `systemctl restart ssh` | فقط بعد نجاح 3 |
| 5 | تغيير كلمة مرور root وتدويرها | بعد 4 |
| 6 | التحقق: محاولة دخول بكلمة مرور من جهاز آخر يجب أن تُرفض | بعد 4 |

## بنود sshd_config الموصى بها

```
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
MaxAuthTries 4
LoginGraceTime 30
```

## ملاحظات

- `fail2ban` يُفعّل من السكربت مع jail للـ sshd (4 محاولات/10 دقائق → ban ساعة).
- الاحتفاظ بدخول root عبر مفتاح (`prohibit-password`) يحافظ على توافق أدوات
  الإدارة الحالية مع إغلاق باب كلمة المرور.
- راجع `ROLLBACK_GUIDE.md` — هذه التغييرات لا تؤثر على حاويات Docker أو البيانات.
