import type { Metadata } from 'next';
import { Space_Grotesk, Manrope, Noto_Sans_Arabic } from 'next/font/google';
import { GoogleAnalytics } from '@next/third-parties/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/components/query-provider';
import { LocaleProvider } from '@/components/locale-provider';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const notoArabic = Noto_Sans_Arabic({
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
  authors: [{ name: 'DZ HOOF', url: 'https://github.com/merci1994dz/dzhoot' }],
  creator: 'DZ HOOF',
  publisher: 'DZ HOOF',
  alternates: {
    canonical: 'https://github.com/merci1994dz/dzhoot',
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
    title: 'Dzhoof IPTV — Self-Hosted IPTV for Android TV',
    description:
      'Import M3U playlists, pair Fire TV devices, manage channels, and monitor streams. Open-source and self-hosted.',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001',
    siteName: 'Dzhoof IPTV',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Dzhoof IPTV — Self-hosted IPTV management console with channel management, device pairing, and stream monitoring',
      },
    ],
    locale: 'ar_DZ',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dzhoof IPTV — Self-Hosted IPTV for Android TV',
    description:
      'Import M3U playlists, pair Fire TV devices, manage channels, and monitor streams. Open-source.',
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
      <body className={`${spaceGrotesk.variable} ${manrope.variable} ${notoArabic.variable} antialiased`}>
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
