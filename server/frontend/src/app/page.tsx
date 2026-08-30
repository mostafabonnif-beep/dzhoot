import type { Metadata } from 'next';
import Link from 'next/link';
import { PlayCircle, Smartphone, ShieldCheck, Headset, Tv, Zap, Download } from 'lucide-react';
import ShopPlans from '@/components/shop-plans';
import WhatsAppButton from '@/components/whatsapp-button';

export const metadata: Metadata = {
  title: 'DZ HOOF — تلفزيون ذكي بلا حدود',
  description:
    'اشترك في DZ HOOF وشاهد آلاف القنوات العربية والعالمية على تلفزيونك وموبايلك. بث مستقر، جودة عالية، وتفعيل فوري بالكود.',
};

const features = [
  { icon: Tv, title: 'آلاف القنوات', desc: 'قنوات جزائرية وعربية وعالمية، رياضة وأفلام وأطفال وأخبار — كل ما تحب في مكان واحد.' },
  { icon: Zap, title: 'بث مستقر', desc: 'نظام تلقائي يحوّلك لمصدر احتياطي في ثوانٍ عند أي انقطاع — بلا انقطاع في المشاهدة.' },
  { icon: Smartphone, title: 'على كل أجهزتك', desc: 'تلفزيون أندرويد، بوكسات IPTV، موبايل وكمبيوتر — فعّل بكود واحد وشاهد على أي جهاز.' },
  { icon: ShieldCheck, title: 'جودة عالية', desc: 'قنوات HD وFHD و4K أينما توفرت، مع تجربة مشاهدة سلسة على مختلف السرعات.' },
  { icon: Headset, title: 'دعم مباشر', desc: 'فريقنا معك عبر واتساب قبل وبعد الاشتراك — تفعيل فوري وحلول سريعة.' },
  { icon: PlayCircle, title: 'فعّل بالكود', desc: 'لا حسابات معقدة: اشترك، استلم الكود، أدخله في التطبيق — وابدأ المشاهدة فوراً.' },
];

const steps = [
  { n: '1', title: 'اختر باقتك', desc: 'حدد الباقة المناسبة لك من الأسعار بالأسفل واطلبها عبر واتساب.' },
  { n: '2', title: 'استلم كودك', desc: 'بعد التأكيد يصلك كود تفعيل فوراً على واتساب أو من المحل.' },
  { n: '3', title: 'فعّل وشاهد', desc: 'حمّل التطبيق، أدخل الكود، وابدأ مشاهدة آلاف القنوات فوراً.' },
];

export default function Home() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TVService',
    name: 'DZ HOOF',
    description: 'خدمة تلفزيون IPTV جزائرية: آلاف القنوات العربية والعالمية على جميع الأجهزة مع تفعيل فوري بالكود.',
    url: 'https://iptv.ld-11.net',
    areaServed: 'DZ',
    provider: { '@type': 'Organization', name: 'DZ HOOF' },
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-extrabold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Tv className="h-5 w-5" aria-hidden="true" />
            </span>
            DZ HOOF
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">المميزات</a>
            <a href="#pricing" className="hover:text-foreground">الأسعار</a>
            <a href="#how" className="hover:text-foreground">طريقة الاشتراك</a>
            <Link href="/download" className="hover:text-foreground">تحميل التطبيق</Link>
          </nav>
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
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--accent)/0.25),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
            أكثر من 16,000 قناة — عربية وعالمية
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
            عالم القنوات… <span className="text-primary">بلا حدود</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            DZ HOOF يوصلك بآلاف القنوات الجزائرية والعربية والعالمية على تلفزيونك وموبايلك —
            بث مستقر، جودة عالية، وتفعيل فوري بكود واحد.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/buy"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3 text-base font-bold text-primary-foreground transition hover:opacity-90"
            >
              <PlayCircle className="h-5 w-5" aria-hidden="true" />
              اشترك الآن
            </Link>
            <Link
              href="/watch"
              className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3 text-base font-semibold transition hover:bg-card"
            >
              <Tv className="h-5 w-5" aria-hidden="true" />
              مشاهدة فورية — أدخل كودك
            </Link>
            <Link
              href="/download"
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-7 py-3 text-base font-semibold text-primary transition hover:bg-primary/10"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              حمّل التطبيق
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3 text-base font-semibold transition hover:bg-card"
            >
              شاهد الأسعار
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-extrabold">لماذا DZ HOOF؟</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6 transition hover:shadow-md">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border/60 bg-card/50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-extrabold">ثلاث خطوات… وتبدأ المشاهدة</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-border bg-background p-6">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-lg font-extrabold text-primary-foreground">
                  {s.n}
                </span>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-extrabold">باقات بأسعار في متناول الجميع</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
          اختر باقتك، ادفع، واستلم كود التفعيل فوراً. الدفع عبر CCP أو البطاقة أو من أقرب محل لنا.
        </p>
        <div className="mt-10">
          <ShopPlans compact />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="rounded-3xl bg-primary p-8 text-center text-primary-foreground sm:p-12">
          <h2 className="text-3xl font-extrabold">جاهز تشوف قنواتك المفضلة؟</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/85">
            انضم لآلاف المشتركين. التفعيل فوري، والدعم مباشر على واتساب.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/buy"
              className="rounded-full bg-white px-7 py-3 text-base font-bold text-primary transition hover:bg-primary-foreground"
            >
              اشترك الآن
            </Link>
            <WhatsAppButton label="تواصل معنا" variant="outline" message="مرحباً DZ HOOF، أريد الاستفسار عن الاشتراك." />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} DZ HOOF — جميع الحقوق محفوظة</span>
          <div className="flex items-center gap-5">
            <Link href="/terms" className="hover:text-foreground">شروط الاستخدام</Link>
            <Link href="/privacy" className="hover:text-foreground">سياسة الخصوصية</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
