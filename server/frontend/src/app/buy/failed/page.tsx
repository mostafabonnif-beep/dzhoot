'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, MessageCircle } from 'lucide-react';

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
        <a
          href="https://wa.me/213000000000"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1fb958]"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          الدفع عبر واتساب
        </a>
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
