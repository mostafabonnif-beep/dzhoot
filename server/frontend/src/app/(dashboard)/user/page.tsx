'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Tv, Smartphone, Copy, Check, ChevronRight, Zap, ExternalLink, Play } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';

interface ProfileData {
  channelListCode?: string;
  channels?: string[];
  metadata?: { lastPairedDevice?: string; deviceModel?: string; pairedAt?: string };
}

export default function UserDashboard() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [channelCount, setChannelCount] = useState<number | null>(null);
  const [channelHealth, setChannelHealth] = useState<{ working: number; failing: number }>({
    working: 0,
    failing: 0,
  });
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  // A failed /auth/me used to be swallowed whole: the dashboard then rendered
  // its normal shell with no code and 0 channels, which is indistinguishable
  // from "my channels were deleted". Surface it and offer a retry.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setOrigin(window.location.origin);
    setLoadError(false);
    const controller = new AbortController();

    async function fetchData() {
      try {
        const [profileRes, channelsRes] = await Promise.all([
          api.get('/auth/me', { signal: controller.signal }),
          api.get('/user-playlist/me/channels', { signal: controller.signal }).catch((err) => {
            if (err.name !== 'CanceledError') console.warn('Failed to load channels:', err.message);
            return null;
          }),
        ]);
        if (controller.signal.aborted) return;
        const data = profileRes.data.user || profileRes.data.data || profileRes.data;
        setProfile(data);
        if (channelsRes) {
          const body = channelsRes.data;
          const list: Array<{ metadata?: { isWorking?: boolean } }> = Array.isArray(body)
            ? body
            : body.data || body.channels || [];
          setChannelCount(list.length);
          const working = list.filter((ch) => ch.metadata?.isWorking === true).length;
          const failing = list.filter((ch) => ch.metadata?.isWorking === false).length;
          setChannelHealth({ working, failing });
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'CanceledError') return;
        setLoadError(true);
      }
    }

    fetchData();
    return () => controller.abort();
  }, [reloadKey]);

  const code = profile?.channelListCode || user?.channelListCode;
  const playlistUrl = code && origin ? `${origin}/api/v1/tv/playlist/${code}` : null;

  function handleCopy() {
    if (playlistUrl) {
      navigator.clipboard.writeText(playlistUrl).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const quickActions = [
    {
      label: 'اختيار سريع',
      desc: 'اعثر على القنوات بسرعة عبر إعداد موجَّه',
      href: '/user/quick-pick',
      icon: Zap,
    },
    { label: 'قنواتي', desc: 'أدر قائمة قنواتك', href: '/user/channels', icon: Tv },
    { label: 'ربط الجهاز', desc: 'اربط تطبيق التلفاز', href: '/user/devices', icon: Smartphone },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-base sm:text-lg font-display font-bold uppercase tracking-[0.1em]">
          لوحة التحكم
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
          مرحباً بعودتك{user?.username ? ` يا ${user.username}` : ''}
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm"
        >
          <span>
            تعذّر تحميل بيانات حسابك. قنواتك وكودك لم يتغيّرا — هذه مشكلة تحميل فقط.
          </span>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="border border-destructive/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide hover:bg-destructive/10"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      <div className="border border-border">
        <div className="grid grid-cols-3 sm:grid-cols-3">
          <div className="p-2.5 sm:p-4">
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.15em] text-muted-foreground">
              القنوات
            </p>
            <p className="text-lg sm:text-2xl font-display font-bold mt-0.5 sm:mt-1.5 tabular-nums">
              {channelCount !== null ? channelCount : '\u2014'}
            </p>
            <div className="flex items-center gap-1.5 mt-1 sm:mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-signal-green" aria-hidden="true" />
              <span className="text-[11px] sm:text-xs text-muted-foreground">
                {channelHealth.working} تعمل
              </span>
              {channelHealth.failing > 0 && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-signal-red" aria-hidden="true" />
                  <span className="text-[11px] sm:text-xs text-muted-foreground">
                    {channelHealth.failing}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="p-2.5 sm:p-4 border-l border-border">
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.15em] text-muted-foreground">
              الجهاز
            </p>
            <p className="text-lg sm:text-2xl font-display font-bold mt-0.5 sm:mt-1.5 truncate">
              {profile?.metadata?.lastPairedDevice || '\u2014'}
            </p>
            <div className="flex items-center gap-1.5 mt-1 sm:mt-2">
              {profile?.metadata?.lastPairedDevice ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-signal-green" aria-hidden="true" />
                  <span className="text-[11px] sm:text-xs text-muted-foreground">مرتبط</span>
                </>
              ) : (
                <>
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40"
                    aria-hidden="true"
                  />
                  <span className="text-[11px] sm:text-xs text-muted-foreground">غير مرتبط</span>
                </>
              )}
            </div>
          </div>
          <div className="p-2.5 sm:p-4 border-l border-border">
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.15em] text-muted-foreground">
              الحساب
            </p>
            <p className="text-lg sm:text-2xl font-display font-bold mt-0.5 sm:mt-1.5 capitalize">
              {user?.role || '\u2014'}
            </p>
            <div className="flex items-center gap-1.5 mt-1 sm:mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-signal-green" aria-hidden="true" />
              <span className="text-[11px] sm:text-xs text-muted-foreground">نشط</span>
            </div>
          </div>
        </div>
      </div>

      {/* Getting Started — shown when user has no channels */}
      {channelCount === 0 && (
        <div className="border border-primary/30 bg-primary/5 p-4 sm:p-5">
          <h3 className="text-sm font-display font-bold uppercase tracking-[0.1em]">
            خطوات البدء
          </h3>
          <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>أضف قنوات — تصفّح المصادر أو استورد قائمة M3U</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Smartphone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>اربط تلفازك — افتح تطبيق Dzhoof وأدخل رمز PIN الظاهر على الشاشة</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Play className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>شاهد — ستظهر قنواتك على التلفاز تلقائياً</span>
            </li>
          </ol>
          <div className="flex flex-wrap gap-3 mt-4">
            <Link
              href="/user/quick-pick"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90"
            >
              <Zap className="h-3.5 w-3.5" /> إضافة قنوات
            </Link>
            <Link
              href="/user/devices"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-border uppercase tracking-[0.1em] transition-colors hover:bg-muted"
            >
              <Smartphone className="h-3.5 w-3.5" /> ربط التلفاز
            </Link>
          </div>
        </div>
      )}

      {/* Playlist Link */}
      <div>
        <h2 className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2 sm:mb-3">
          رابط قائمة التشغيل
        </h2>
        <div className="border border-border p-3 sm:p-4">
          {playlistUrl ? (
            <div className="space-y-2 sm:space-y-3">
              <code className="block text-[11px] sm:text-xs text-muted-foreground bg-muted px-2.5 py-1.5 sm:px-3 sm:py-2 truncate border border-border">
                {playlistUrl}
              </code>
              <div className="flex items-center gap-2">
                <a
                  href={playlistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] border border-border transition-colors hover:bg-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  فتح M3U
                </a>
                <button
                  onClick={handleCopy}
                  aria-label="نسخ إلى الحافظة"
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] border border-border transition-colors hover:bg-muted"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-signal-green" /> تم النسخ
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> نسخ
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              لا توجد قائمة تشغيل بعد. أضف قنوات إلى قائمتك أولاً.
            </p>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2 sm:mb-3">
          إجراءات سريعة
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.href}
                onClick={() => router.push(action.href)}
                className="flex items-center gap-3 border border-border bg-card p-3 sm:p-4 text-left transition-colors hover:border-primary/40 group"
              >
                <div className="flex items-center justify-center h-9 w-9 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium uppercase tracking-[0.05em]">{action.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
