import type { Metadata } from 'next';
import { Noto_Kufi_Arabic, Cairo } from 'next/font/google';
import { GoogleAnalytics } from '@next/third-parties/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/components/query-provider';
import { LocaleProvider } from '@/components/locale-provider';

const notoKufi = Noto_Kufi_Arabic({
  subsets: ['arabic'],
  variable: '--font-display',
  display: 'swap',
});

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  variable: '--font-body',
  display: 'swap',
});

const notoArabic = Noto_Kufi_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'),
  title: {
    default: 'DZ HOOF IPTV — منصة إدارة وتشغيل القنوات',
    template: '%s | DZ HOOF IPTV',
  },
  description:
    'منصة DZ HOOF لإدارة وتشغيل مصادر IPTV المصرح بها، واستيراد قوائم M3U وإدارة القنوات وربط الأجهزة ومراقبة البث من لوحة واحدة.',
  keywords: [
    'IPTV',
    'Android TV',
    'Fire TV',
    'IPTV player',
    'self-hosted IPTV',
    'M3U player',
    'channel management',
    'IPTV server',
    'streaming',
    'Fire TV IPTV app',
    'open source IPTV',
  ],
  authors: [{ name: 'DZ HOOF', url: 'https://github.com/mostafabonnif-beep/dzhoot' }],
  creator: 'DZ HOOF',
  publisher: 'DZ HOOF',
  alternates: {
    canonical: '/',
    types: {
      'text/plain': '/llms.txt',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: 'DZ HOOF IPTV — منصة IPTV قانونية ومدارة ذاتيًا',
    description:
      'منصة لإدارة مصادر IPTV المصرح بها، والأجهزة، والقنوات والاشتراكات من واجهة واحدة.',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001',
    siteName: 'DZ HOOF IPTV',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'DZ HOOF IPTV — منصة إدارة القنوات والأجهزة والمصادر',
      },
    ],
    locale: 'ar_DZ',
    type: 'website',
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192' }],
    shortcut: ['/favicon.ico'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DZ HOOF IPTV — منصة IPTV قانونية ومدارة ذاتيًا',
    description:
      'إدارة مصادر IPTV المصرح بها والأجهزة والقنوات والاشتراكات من واجهة واحدة.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${notoKufi.variable} ${cairo.variable} ${notoArabic.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <LocaleProvider>
            <QueryProvider>{children}</QueryProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
      {process.env.GA_MEASUREMENT_ID && <GoogleAnalytics gaId={process.env.GA_MEASUREMENT_ID} />}
      {process.env.FRONTEND_SENTRY_DSN && (
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SENTRY_DSN__=${JSON.stringify(process.env.FRONTEND_SENTRY_DSN)};`,
          }}
        />
      )}
    </html>
  );
}
