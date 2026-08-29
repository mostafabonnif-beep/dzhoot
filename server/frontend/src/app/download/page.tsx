'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Tv, Download, Loader2, MonitorSmartphone, ShieldCheck, Zap, CircleCheck, ArrowRight } from 'lucide-react';
import api from '@/lib/api';

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

const installSteps = [
  {
    title: 'حمّل ملف التطبيق',
    desc: 'اضغط زر التحميل بالأسفل واحفظ ملف APK على جهازك (تلفاز أندرويد، بوكس، أو موبايل).',
  },
  {
    title: 'اسمح بالتثبيت',
    desc: 'عند الفتح قد يطلب الجهاز السماح بالتثبيت من مصادر غير معروفة — فعّلها مرة واحدة فقط.',
  },
  {
    title: 'افتح وفعّل بالكود',
    desc: 'افتح التطبيق، أدخل كود التفعيل الذي استلمته، وابدأ المشاهدة فوراً.',
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/app/latest');
        const data: LatestVersion | undefined = res.data?.data;
        if (!cancelled && data?.downloadUrl) {
          setVersion(data);
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
                  href={version.downloadUrl}
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

      {/* Install steps */}
      <section className="mx-auto max-w-4xl px-4 pb-20">
        <h2 className="mb-8 text-center text-2xl font-extrabold">طريقة التثبيت في 3 خطوات</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {installSteps.map((step, i) => (
            <li
              key={step.title}
              className="relative rounded-2xl border border-border bg-card p-5 text-right"
            >
              <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">
                {i + 1}
              </span>
              <h3 className="mb-1.5 text-base font-bold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
            </li>
          ))}
        </ol>

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
