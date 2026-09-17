'use client';

import { useEffect, useState } from 'react';
import { Loader2, Smartphone, Copy, Check, Wifi, Camera } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import QrScanner from '@/components/qr-scanner';

interface PairedDevice {
  name: string;
  model: string;
  pairedAt: string;
}

export default function PairDevicePage() {
  const { user } = useAuthStore();
  const [pin, setPin] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [pairedDevice, setPairedDevice] = useState<PairedDevice | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [origin, setOrigin] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      const res = await api.get('/auth/me');
      const data = res.data.user || res.data.data || res.data;
      if (data.metadata?.lastPairedDevice) {
        setPairedDevice({
          name: data.metadata.lastPairedDevice,
          model: data.metadata.deviceModel || 'غير معروف',
          pairedAt: data.metadata.pairedAt || '',
        });
      }
    } catch {
      // ignore
    } finally {
      setLoadingProfile(false);
    }
  }

  async function handleConfirmPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || pin.length !== 6) return;
    setConfirming(true);
    setResult(null);

    try {
      const res = await api.post('/tv/pairing/confirm', { pin });
      const body = res.data;
      setResult({ success: true, message: body.message || 'تم ربط الجهاز بنجاح!' });
      if (body.device) {
        setPairedDevice({
          name: body.device.name,
          model: body.device.model,
          pairedAt: new Date().toISOString(),
        });
      }
      setPin('');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setResult({
        success: false,
        message:
          axiosErr.response?.data?.error ||
          'فشل تأكيد الربط. تحقق من رمز PIN وحاول مرة أخرى.',
      });
    } finally {
      setConfirming(false);
    }
  }

  function handleCopyCode() {
    if (!user?.channelListCode) return;
    navigator.clipboard.writeText(user.channelListCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  }

  function handleCopyUrl() {
    if (!user?.channelListCode || !origin) return;
    navigator.clipboard.writeText(`${origin}/api/v1/tv/playlist/${user.channelListCode}`);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  }

  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
          ربط جهاز تلفاز
        </h1>
        <p className="text-sm text-muted-foreground mt-1">اربط تطبيق Fire TV أو Android TV</p>
      </div>

      {/* PIN Confirmation */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            أدخل رمز PIN الظاهر على التلفاز
          </p>
        </div>
        <div className="p-5">
          <div className="text-sm text-muted-foreground mb-4 space-y-1.5">
            <p>
              <strong className="text-foreground">الخطوة 1:</strong> ثبّت تطبيق Dzhoof على جهاز
              Fire TV أو Android TV وافتحه
            </p>
            <p>
              <strong className="text-foreground">الخطوة 2:</strong> سيظهر رمز PIN مكوّن من 6 أرقام
              على شاشة التلفاز
            </p>
            <p>
              <strong className="text-foreground">الخطوة 3:</strong> أدخل الرمز أدناه لربط
              تلفازك
            </p>
          </div>
          <form onSubmit={handleConfirmPin} className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5 flex-1 max-w-xs">
              <label
                htmlFor="pairing-pin"
                className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
              >
                رمز PIN
              </label>
              <input
                id="pairing-pin"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="flex h-12 w-full border border-border bg-background px-4 py-2 text-2xl font-mono font-bold tracking-[0.3em] text-center focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary placeholder:text-muted-foreground/80"
              />
            </div>
            <button
              type="submit"
              disabled={confirming || pin.length !== 6}
              className="inline-flex items-center gap-2 h-12 px-6 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> جارٍ الربط...
                </>
              ) : (
                <>
                  <Wifi className="h-4 w-4" /> ربط الجهاز
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="inline-flex items-center gap-2 h-12 px-6 text-sm font-medium border border-border uppercase tracking-[0.1em] transition-colors hover:bg-muted"
            >
              <Camera className="h-4 w-4" /> مسح QR
            </button>
          </form>

          <QrScanner
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onScan={(scannedPin) => {
              setScannerOpen(false);
              setPin(scannedPin);
              // Auto-submit the pairing
              setConfirming(true);
              setResult(null);
              api
                .post('/tv/pairing/confirm', { pin: scannedPin })
                .then((res) => {
                  const body = res.data;
                  setResult({
                    success: true,
                    message: body.message || 'تم ربط الجهاز بنجاح!',
                  });
                  if (body.device) {
                    setPairedDevice({
                      name: body.device.name,
                      model: body.device.model,
                      pairedAt: new Date().toISOString(),
                    });
                  }
                  setPin('');
                })
                .catch((err: unknown) => {
                  const axiosErr = err as { response?: { data?: { error?: string } } };
                  setResult({
                    success: false,
                    message:
                      axiosErr.response?.data?.error ||
                      'فشل تأكيد الربط. تحقق من رمز PIN وحاول مرة أخرى.',
                  });
                })
                .finally(() => setConfirming(false));
            }}
          />

          {result && (
            <div
              role="alert"
              aria-live="polite"
              className={`mt-4 px-4 py-3 text-sm border ${
                result.success
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-destructive/40 bg-destructive/10 text-destructive'
              }`}
            >
              {result.message}
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground/70">
            لا يظهر لك رمز؟ تأكد أن تطبيق Dzhoof مثبّت ومفتوح على تلفازك.
          </p>
        </div>
      </div>

      {/* Channel List Code */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            كود قائمة القنوات الخاص بك
          </p>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground mb-3">
            هذا الكود يعرّف قائمة تشغيلك بشكل فريد. أدخله في إعدادات تطبيق التلفاز لتحميل قنواتك
            دون إعادة الربط.
          </p>
          <div className="flex items-center gap-3">
            <code className="text-2xl font-mono font-bold bg-muted px-4 py-2 tracking-[0.3em]">
              {user?.channelListCode || '------'}
            </code>
            {user?.channelListCode && (
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                aria-label="نسخ إلى الحافظة"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-4 w-4 text-signal-green" /> تم النسخ
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> نسخ
                  </>
                )}
              </button>
            )}
          </div>

          {user?.channelListCode && origin && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
                رابط قائمة M3U
              </p>
              <div className="flex items-center gap-3">
                <code className="flex-1 text-xs text-muted-foreground bg-muted px-3 py-2 truncate border border-border">
                  {origin}/api/v1/tv/playlist/{user.channelListCode}
                </code>
                <button
                  onClick={handleCopyUrl}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label="نسخ إلى الحافظة"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="h-4 w-4 text-signal-green" /> تم النسخ
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> نسخ
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Last Paired Device */}
      <div className="border border-border">
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
            آخر جهاز مرتبط
          </p>
        </div>
        <div className="p-5">
          {pairedDevice ? (
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center h-10 w-10 bg-primary/10 text-primary">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">{pairedDevice.name}</p>
                <p className="text-xs text-muted-foreground">{pairedDevice.model}</p>
                {pairedDevice.pairedAt && (
                  <p className="text-xs text-muted-foreground">
                    رُبط في {new Date(pairedDevice.pairedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              لا توجد أجهزة مرتبطة بعد. افتح Dzhoof على Android TV لبدء الربط.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
