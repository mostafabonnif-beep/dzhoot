'use client';

import { useEffect, useState, useCallback } from 'react';
import { MessageCircle, Loader2 } from 'lucide-react';

type Plan = { _id: string; name: string; durationDays: number; price: number };
type ShopData = { brand: string; whatsapp: string; shop: { name: string; phone: string } | null; plans: Plan[] };

function durationLabel(days: number): string {
  if (days >= 360) return 'سنة كاملة';
  if (days >= 175) return '6 أشهر';
  if (days >= 85) return '3 أشهر';
  if (days >= 45) return 'شهر ونصف';
  if (days >= 27) return 'شهر';
  return `${days} يوم`;
}

export default function ShopPlans({ shopId, compact }: { shopId?: string; compact?: boolean }) {
  const [data, setData] = useState<ShopData | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = shopId ? `?shop=${encodeURIComponent(shopId)}` : '';
      const r = await fetch(`/api/v1/shop/plans${q}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.success) setData(j.data);
      else setError(true);
    } catch {
      setError(true);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        تعذّر تحميل الأسعار — تواصل معنا مباشرة على واتساب.
      </p>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const phone = data.shop?.phone || data.whatsapp;
  const shopLabel = data.shop ? data.shop.name : data.brand;
  const waNumber = String(phone || '').replace(/[^\d]/g, '');
  const waLink = (plan: Plan) =>
    `https://wa.me/${waNumber}?text=${encodeURIComponent(
      `مرحباً ${shopLabel}، أريد الاشتراك في باقة «${plan.name}» (${durationLabel(plan.durationDays)} — ${plan.price} دج).`,
    )}`;

  return (
    <div className="space-y-6">
      {data.shop && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          🏪 أنت تطلب من محل <strong>{data.shop.name}</strong>
        </div>
      )}
      <div className={`grid gap-4 ${compact ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        {data.plans.length === 0 && (
          <p className="col-span-full text-center text-muted-foreground">لا توجد باقات متاحة حالياً.</p>
        )}
        {data.plans.map((plan) => (
          <div
            key={plan._id}
            className="group flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:shadow-md"
          >
            <div className="text-lg font-bold text-foreground">{plan.name}</div>
            <div className="mt-1 text-sm text-muted-foreground">{durationLabel(plan.durationDays)}</div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-primary">{plan.price.toLocaleString('fr-DZ')}</span>
              <span className="text-sm text-muted-foreground">دج</span>
            </div>
            {waNumber ? (
              <a
                href={waLink(plan)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1fb958]"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                اطلب عبر واتساب
              </a>
            ) : (
              <a
                href="/buy"
                className="mt-5 inline-flex items-center justify-center rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                اطلب الاشتراك
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
