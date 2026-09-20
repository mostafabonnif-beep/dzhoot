import type { Metadata } from 'next';

// Without a per-route title every page inherited the root default
// ("DZ HOOF IPTV — منصة إدارة وتشغيل القنوات"), so all tabs, shares and search
// results looked identical. The root layout's `title.template` appends the brand.
export const metadata: Metadata = {
  title: 'تحميل التطبيق',
  description: 'حمّل تطبيق DZ HOOF الرسمي لأجهزة Android TV والبوكسات والهواتف.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
