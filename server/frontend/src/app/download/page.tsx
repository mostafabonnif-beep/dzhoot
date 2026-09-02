'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  Tv,
  Download,
  Loader2,
  MonitorSmartphone,
  ShieldCheck,
  Zap,
  CircleCheck,
  ArrowRight,
  QrCode,
  Usb,
  FolderOpen,
  Smartphone,
  Github,
} from 'lucide-react';
import api from '@/lib/api';

const DOWNLOAD_URL = '/api/v1/app/download';

interface LatestVersion {
  versionName: string;
  versionCode: number;
  releaseNotes?: string;
  apkFileName?: string;
  apkFileSize?: number;
  downloadUrl: string;
  releasedAt?: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} ميغابايت`;
}

const phoneSteps = [
  {
    title: 'حمّل ملف التطبيق',
    desc: 'اضغط زر التحميل (أو امسح رمز QR بالأسفل) واحفظ ملف APK على موبايلك.',
  },
  {
    title: 'اسمح بالتثبيت',
    desc: 'عند فتح الملف قد يطلب الهاتف السماح بالتثبيت من مصادر غير معروفة — فعّلها مرة واحدة فقط.',
  },
  {
    title: 'افتح وفعّل بالكود',
    desc: 'افتح التطبيق، أدخل كود التفعيل الذي استلمته، وابدأ المشاهدة فوراً.',
  },
];

const tvSteps = [
  {
    icon: Usb,
    title: 'حمّل على موبايلك',
    desc: 'امسح رمز QR بهاتفك وحمّل ملف APK (نسخة التلفاز هي نفس النسخة — ملف واحد لكل الأجهزة).',
  },
  {
    icon: FolderOpen,
    title: 'انقل الملف للتلفاز',
    desc: 'انقل الـAPK عبر فلاشة USB، أو تطبيق نقل ملفات (مثل Send Anywhere)، أو مدير ملفات مشترك على الشبكة.',
  },
  {
    icon: Tv,
    title: 'افتحه واسمح بالتثبيت',
    desc: 'من «مدير الملفات» في التلفاز افتح الـAPK، واسمح بالتثبيت من مصادر غير معروفة عندما يُطلب منك.',
  },
  {
    icon: Smartphone,
    title: 'فعّل بالكود وابدأ',
    desc: 'ادخل كود التفعيل من هاتفك (أو اكتبه يدوياً) — جهازك يفعَّل فوراً وتبدأ المشاهدة.',
  },
];

const highlights = [
  { icon: Zap, text: 'بث مستقر مع تحويل تلقائي للمصدر الاحتياطي' },
  { icon: MonitorSmartphone, text: 'يعمل على تلفاز أندرويد والبوكسات والموبايل' },
  { icon: ShieldCheck, text: 'تفعيل آمن بكود واحد — بلا حسابات معقدة' },
];

export default function DownloadPage() {
  const [version, setVersion] = useState<LatestVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/app/latest');
        const data: LatestVersion | undefined = res.data?.data;
        if (!cancelled && data?.downloadUrl) {
          setVersion({ ...data, downloadUrl: DOWNLOAD_URL });
        } else if (!cancelled) {
          setError('تعذر جلب معلومات الإصدار — حاول مجدداً.');
        }
      } catch {
        if (!cancelled) setError('تعذر الاتصال بالخادم — تحقق من الشبكة وحاول مجدداً.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Generate the QR once we know the download URL (links straight to the APK).
  useEffect(() => {
    if (!version?.downloadUrl) return;
    let cancelled = false;
    QRCode.toDataURL(DOWNLOAD_URL, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b3d2e', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        /* QR is a convenience — the download button always remains */
      });
    return () => {
      cancelled = true;
    };
  }, [version?.downloadUrl]);

  return (
    <main dir="rtl" className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-extrabold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Tv className="h-5 w-5" aria-hidden="true" />
            </span>
            DZ HOOF
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/watch"
              className="rounded-full border border-border px-5 py-2 text-sm font-semibold transition hover:bg-card"
            >
              مشاهدة الآن
            </Link>
            <Link
              href="/buy"
              className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              اشترك الآن
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--accent)/0.22),transparent)]" />
        <div className="relative mx-auto max-w-3xl px-4 pb-12 pt-16 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            تطبيق DZ HOOF الرسمي
          </span>
          <h1 className="mx-auto mt-6 text-4xl font-extrabold leading-tight sm:text-5xl">
            حمّل التطبيق وشاهد آلاف القنوات
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            تطبيق واحد لتلفاز أندرويد والبوكسات والموبايل — تثبيت في دقيقة وتفعيل فوري بالكود.
          </p>

          {/* Download card */}
          <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-border bg-card p-6 text-right shadow-lg">
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                جارٍ جلب أحدث إصدار…
              </div>
            ) : error ? (
              <div className="py-6 text-center text-sm text-destructive">{error}</div>
            ) : version ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">أحدث إصدار</p>
                    <p className="mt-0.5 text-2xl font-extrabold">
                      الإصدار {version.versionName}
                      <span className="ms-2 align-middle text-xs font-medium text-muted-foreground">
                        (Build {version.versionCode})
                      </span>
                    </p>
                  </div>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Tv className="h-6 w-6" aria-hidden="true" />
                  </span>
                </div>

                {version.releaseNotes ? (
                  <p className="mt-4 rounded-xl bg-muted/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                    <span className="mb-1 block font-semibold text-foreground">ما الجديد:</span>
                    {version.releaseNotes}
                  </p>
                ) : null}

                <a
                  href={DOWNLOAD_URL}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-primary-foreground transition hover:opacity-90"
                >
                  <Download className="h-5 w-5" aria-hidden="true" />
                  تحميل التطبيق الآن
                  {version.apkFileSize ? (
                    <span className="text-sm font-medium opacity-80">({formatBytes(version.apkFileSize)})</span>
                  ) : null}
                </a>

                <p className="mt-3 text-center text-xs text-muted-foreground">
                  {version.apkFileName ? `الملف: ${version.apkFileName}` : ''}
                  {version.releasedAt
                    ? ` — صدر في ${new Date(version.releasedAt).toLocaleDateString('ar-DZ')}`
                    : ''}
                </p>

                {/* QR — instant download on the phone, then transfer to the TV */}
                {qrDataUrl ? (
                  <div className="mt-6 flex items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/40 p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrDataUrl}
                      alt="رمز QR لتحميل التطبيق"
                      width={132}
                      height={132}
                      className="h-[132px] w-[132px] rounded-lg bg-white p-1.5"
                    />
                    <div className="max-w-[220px] text-right text-xs leading-relaxed text-muted-foreground">
                      <p className="mb-1 flex items-center gap-1.5 font-bold text-foreground">
                        <QrCode className="h-4 w-4 text-primary" aria-hidden="true" />
                        لتركيب سريع على التلفاز
                      </p>
                      امسح الرمز بهاتفك ليُفتح التحميل مباشرة — ثم انقل الملف للتلفاز كما في الخطوات بالأسفل.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Highlights */}
          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
            {highlights.map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-3 text-right text-xs leading-relaxed text-muted-foreground"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Install steps — phone + TV */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-2 text-center text-2xl font-extrabold">طريقة التثبيت</h2>
        <p className="mb-10 text-center text-sm text-muted-foreground">
          ملف واحد يعمل على كل الأجهزة — اختر جهازك واتبع الخطوات.
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Phone / tablet */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-5 flex items-center gap-2 text-lg font-extrabold">
              <MonitorSmartphone className="h-5 w-5 text-primary" aria-hidden="true" />
              موبايل / تابلت
            </h3>
            <ol className="space-y-5">
              {phoneSteps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div>
                    <h4 className="font-bold">{step.title}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Android TV / box */}
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-6">
            <h3 className="mb-5 flex items-center gap-2 text-lg font-extrabold">
              <Tv className="h-5 w-5 text-primary" aria-hidden="true" />
              تلفاز أندرويد / بوكس
            </h3>
            <ol className="space-y-5">
              {tvSteps.map(({ icon: Icon, title, desc }, i) => (
                <li key={title} className="flex gap-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div>
                    <h4 className="flex items-center gap-1.5 font-bold">
                      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                      {title}
                    </h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Alternative source */}
        <div className="mx-auto mt-8 flex max-w-2xl flex-col items-center gap-2 rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <Github className="ms-1 inline h-4 w-4 align-[-2px] text-primary" aria-hidden="true" />
            رابط التحميل الرسمي البديل متوفر دائماً على مخزن GitHub للمشروع —
          </p>
          <a
            href="https://github.com/mostafabonnif-beep/dzhoot/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-primary underline-offset-4 hover:underline"
          >
            github.com/mostafabonnif-beep/dzhoot/releases
          </a>
        </div>

        <div className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
          <CircleCheck className="h-8 w-8 text-primary" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            ليس لديك كود تفعيل بعد؟ اطلب اشتراكك الآن ويصلك الكود فوراً على واتساب.
          </p>
          <Link
            href="/buy"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground transition hover:opacity-90"
          >
            اطلب اشتراكك
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
