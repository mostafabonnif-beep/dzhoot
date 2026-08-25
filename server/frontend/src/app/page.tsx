import Image from 'next/image';
import Link from 'next/link';
import { ExternalLink, Download } from 'lucide-react';

const capabilities = [
  {
    title: 'إدارة القنوات',
    desc: 'أضف قنوات IPTV ونظّمها واختبرها مع استيراد M3U ومعاينة البث المباشر.',
  },
  {
    title: 'استيراد من مصادر متعددة',
    desc: 'استورد من IPTV-org وPluto TV وSamsung TV Plus مع تصفية حسب المنطقة.',
  },
  {
    title: 'ربط الأجهزة',
    desc: 'اربط أجهزة التلفاز عبر رموز الاقتران وتابع حالتها وعيّنها للمستخدمين.',
  },
  {
    title: 'المستخدمون والتحكم في الوصول',
    desc: 'أدر المستخدمين حسب الصلاحيات مع رموز قوائم القنوات وتتبع الجلسات والنشاط.',
  },
  {
    title: 'تحليلات النظام',
    desc: 'لوحة لحظية لمؤشرات القنوات والمستخدمين والأجهزة والجلسات.',
  },
];

export default function Home() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'DZ HOOF IPTV',
        description:
          'Self-hosted IPTV management console for Android TV and Fire TV. Import M3U playlists, manage channels, pair devices, and monitor streams.',
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Android TV, Fire OS',
        url: 'https://github.com/mostafabonnif-beep/dzhoot',
        downloadUrl: 'https://github.com/mostafabonnif-beep/dzhoot/releases/latest',
        softwareVersion: '1.0.1',
        author: {
          '@type': 'Person',
          name: "mostafabonnif-beep",
          url: 'https://github.com/mostafabonnif-beep',
        },
        publisher: {
          '@type': 'Organization',
          name: 'DZ HOOF',
          url: 'https://github.com/mostafabonnif-beep/dzhoot',
        },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        featureList: [
          'M3U playlist import',
          'Channel management with DRM support',
          'Fire TV device pairing',
          'Multi-source import (IPTV-org, Pluto TV, Samsung TV Plus)',
          'Role-based access control',
          'Real-time analytics dashboard',
          'Self-hosted deployment',
        ],
        screenshot: 'https://github.com/mostafabonnif-beep/dzhoot/og-image.png',
        license: 'https://github.com/mostafabonnif-beep/dzhoot/blob/main/LICENSE',
      },
      {
        '@type': 'WebSite',
        name: 'DZ HOOF IPTV',
        url: 'https://github.com/mostafabonnif-beep/dzhoot',
        description: 'Self-hosted IPTV management console for Android TV and Fire TV.',
        publisher: {
          '@type': 'Organization',
          name: 'DZ HOOF',
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is DZ HOOF IPTV?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'DZ HOOF IPTV is a free, open-source, self-hosted IPTV management console. It provides an Android TV / Fire TV player app and a web-based admin dashboard for managing channels, devices, and users.',
            },
          },
          {
            '@type': 'Question',
            name: 'What devices does DZ HOOF IPTV support?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'DZ HOOF IPTV supports Amazon Fire TV, Fire TV Stick, and Android TV devices. The management console runs as a self-hosted web application accessible from any browser.',
            },
          },
          {
            '@type': 'Question',
            name: 'Can I import M3U playlists into DZ HOOF IPTV?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. DZ HOOF IPTV supports M3U playlist import, along with built-in sources like IPTV-org, Pluto TV, and Samsung TV Plus with region-based filtering.',
            },
          },
          {
            '@type': 'Question',
            name: 'Is DZ HOOF IPTV free?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes, DZ HOOF IPTV is completely free and open source. You can self-host the server using Docker and download the Android TV app from GitHub releases.',
            },
          },
          {
            '@type': 'Question',
            name: 'How do I deploy DZ HOOF IPTV?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'DZ HOOF IPTV can be deployed using Docker Compose. The project includes production-ready Docker configurations. Visit the GitHub repository for the deployment guide.',
            },
          },
        ],
      },
    ],
  };

  return (
    <main className="h-screen supports-[height:100dvh]:h-dvh overflow-y-auto bg-background relative flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="absolute inset-0 grid-bg opacity-50 dark:opacity-40" />

      <div className="relative z-10 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 h-10 flex items-center justify-end">
          <span className="text-xs text-muted-foreground">v1.0.1</span>
        </div>
      </div>

      <div className="relative z-10 flex-1 flex items-center">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 w-full py-20 lg:py-0">
          <div className="grid lg:grid-cols-[1fr,280px] gap-16 lg:gap-20 items-start">
            <div>
              <Image
                src="/flame.svg"
                alt="Dzhoof logo"
                width={260}
                height={260}
                className="mb-6 w-24 h-24 sm:w-36 sm:h-36 lg:w-[260px] lg:h-[260px]"
                priority
              />
              <h1 className="text-5xl sm:text-6xl lg:text-[5.5rem] font-display font-bold tracking-tight leading-none text-primary">
                DZ HOOF IPTV
              </h1>

              <p className="mt-4 text-sm uppercase tracking-widest text-muted-foreground font-medium">
                لوحة إدارة IPTV
              </p>

              <p className="mt-6 text-muted-foreground max-w-md leading-relaxed">
                إدارة مركزية للقنوات وربط الأجهزة ومراقبة البث ضمن منصتك.
              </p>

              <nav aria-label="ابدأ الآن" className="flex flex-wrap items-center gap-3 mt-10">
                <Link
                  href="/login"
                  className="inline-flex items-center bg-primary text-primary-foreground px-8 py-3 text-sm font-semibold uppercase tracking-widest transition-colors hover:bg-primary/90 active:bg-primary/80"
                >
                  تسجيل الدخول
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center border border-border px-8 py-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/20 active:bg-secondary"
                >
                  إنشاء حساب
                </Link>
              </nav>
              <a
                href="https://github.com/mostafabonnif-beep/dzhoot/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 mt-4 border-2 border-primary/30 bg-primary/5 px-8 py-4 text-sm font-semibold uppercase tracking-widest text-foreground hover:bg-primary/10 hover:border-primary/50 transition-colors"
              >
                <Download className="h-5 w-5 text-primary" aria-hidden="true" />
                <span>تنزيل تطبيق Android TV</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </div>

            <div className="border-l border-border pl-8 hidden lg:block">
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-8">
                المزايا
              </p>
              <ol className="space-y-6">
                {capabilities.map((cap, i) => (
                  <li key={i}>
                    <span className="text-xs text-primary font-medium" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p className="text-sm font-medium mt-0.5">{cap.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{cap.desc}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="mt-16 border-t border-border pt-8 lg:hidden">
            <ol className="grid sm:grid-cols-2 gap-6">
              {capabilities.map((cap, i) => (
                <li key={i}>
                  <span className="text-xs text-primary font-medium" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="text-sm font-medium mt-0.5">{cap.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{cap.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <footer className="relative z-10 border-t border-border">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} DZ HOOF IPTV <span aria-hidden="true">&bull;</span>{' '}
            مشروع مفتوح المصدر
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/privacy"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              سياسة الخصوصية
            </Link>
            <span className="text-muted-foreground/40 hidden sm:inline" aria-hidden="true">
              &bull;
            </span>
            <Link
              href="/terms"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              شروط الاستخدام
            </Link>
            <span className="text-muted-foreground/40 hidden sm:inline" aria-hidden="true">
              &bull;
            </span>
            <a
              href="https://github.com/mostafabonnif-beep/dzhoot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              عرض الشيفرة المصدرية
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            <span className="text-muted-foreground/40 hidden sm:inline" aria-hidden="true">
              &bull;
            </span>
            <a
              href="https://github.com/mostafabonnif-beep"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              طوّره فريق DZ HOOF
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
