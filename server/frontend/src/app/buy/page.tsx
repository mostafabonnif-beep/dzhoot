import type { Metadata } from 'next';
import Link from 'next/link';
import { Tv, KeyRound, MessageCircle } from 'lucide-react';
import ShopPlans from '@/components/shop-plans';
import WhatsAppButton from '@/components/whatsapp-button';

export const metadata: Metadata = {
  title: 'اشترك الآن — DZ HOOF',
  description: 'اختر باقتك من DZ HOOF واشترك عبر واتساب أو من أقرب محل. استلم كود التفعيل فوراً.',
};

export default function BuyPage({
  searchParams,
}: {
  searchParams: { shop?: string };
}) {
  const shopId = typeof searchParams.shop === 'string' ? searchParams.shop : undefined;

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-extrabold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Tv className="h-5 w-5" aria-hidden="true" />
            </span>
            DZ HOOF
          </Link>
          <Link
            href="/"
            className="rounded-full border border-border px-5 py-2 text-sm font-semibold transition hover:bg-card"
          >
            الرئيسية
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold">اشترك الآن</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            اختر باقتك، اطلبها عبر واتساب أو من أقرب محل، واستلم كود التفعيل فوراً.
          </p>
        </div>

        <div className="mt-10">
          <ShopPlans shopId={shopId} />
        </div>

        <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-bold">عندك كود تفعيل؟</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                حمّل التطبيق على تلفزيون أندرويد أو موبايلك، افتح «تفعيل بالكود»، وأدخل الكود الذي استلمته —
                سيفعَّل جهازك فوراً وتبدأ المشاهدة.
              </p>
              <Link
                href="/pair"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                تفعيل بالكود
              </Link>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-[#25D366]/40 bg-[#25D366]/5 p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#25D366]/15 text-[#128C4A]">
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-bold">تحتاج مساعدة في الاختيار؟</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                راسلنا على واتساب — نرشح لك الباقة المناسبة ونجيبك على كل أسئلتك.
              </p>
              <div className="mt-3">
                <WhatsAppButton label="راسلنا الآن" message="مرحباً DZ HOOF، أحتاج مساعدة في اختيار الباقة." />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
