'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import WhatsAppButton from '@/components/whatsapp-button';

function FailedContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  return (
    <div className="text-center space-y-5 max-w-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
        <AlertCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-xl font-bold">لم تكتمل عملية الدفع</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          لم يتم خصم أي مبلغ من بطاقتك. يمكنك إعادة المحاولة أو الدفع عبر واتساب بدلاً من ذلك.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Link
          href={token ? `/buy/success?token=${encodeURIComponent(token)}` : '/buy'}
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          إعادة المحاولة
        </Link>
        <WhatsAppButton label="الدفع عبر واتساب" message="مرحباً DZ HOOF، أواجه مشكلة في الدفع وأريد إتمام الاشتراك." />
        <Link href="/buy" className="text-sm text-muted-foreground underline">
          العودة لصفحة الاشتراك
        </Link>
      </div>
    </div>
  );
}

export default function BuyFailedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Suspense
        fallback={
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          </div>
        }
      >
        <FailedContent />
      </Suspense>
    </main>
  );
}
