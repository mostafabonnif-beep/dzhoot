'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Tv, Check, Loader2, AlertCircle, Copy, CopyCheck } from 'lucide-react';

type StatusState = 'loading' | 'pending' | 'paid' | 'failed' | 'canceled' | 'not-found';

type StatusData = {
  status: string;
  planName: string | null;
  durationDays: number | null;
  amount: number;
  currency: string;
  code?: string | null;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 2 * 60 * 1000; // give the webhook up to 2 minutes to land

function SuccessContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<StatusState>('loading');
  const [data, setData] = useState<StatusData | null>(null);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (!token) {
      setState('not-found');
      return;
    }
    try {
      const r = await fetch(`/api/v1/payments/status/${encodeURIComponent(token)}`, {
        cache: 'no-store',
      });
      if (r.status === 404) {
        setState('not-found');
        return;
      }
      const j = await r.json();
      if (!j.success) {
        setState('not-found');
        return;
      }
      const d: StatusData = j.data;
      setData(d);
      if (d.status === 'paid') {
        setState('paid');
        return; // stop polling
      }
      if (d.status === 'failed' || d.status === 'canceled') {
        setState(d.status);
        return; // stop polling
      }
      setState('pending');
      if (Date.now() - startedAt.current < MAX_POLL_MS) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    } catch {
      if (Date.now() - startedAt.current < MAX_POLL_MS) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }
  }, [token]);

  useEffect(() => {
    poll();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll]);

  const copyCode = useCallback(() => {
    if (!data?.code) return;
    navigator.clipboard?.writeText(data.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  if (!token || state === 'not-found') {
    return (
      <div className="text-center space-y-4 max-w-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-bold">لم نجد عملية الدفع</h1>
        <p className="text-sm text-muted-foreground">
          الرابط غير صالح أو انتهت صلاحيته. تواصل معنا عبر واتساب إن استمرت المشكلة.
        </p>
        <Link
          href="/buy"
          className="inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          العودة للاشتراك
        </Link>
      </div>
    );
  }

  if (state === 'loading' || state === 'pending') {
    return (
      <div className="text-center space-y-4 max-w-sm">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <h1 className="text-lg font-bold">جاري تأكيد عملية الدفع...</h1>
        <p className="text-sm text-muted-foreground">
          {data?.planName ? (
            <>
              باقة <strong>{data.planName}</strong> — {data.amount?.toLocaleString('fr-DZ')}{' '}
              {(data.currency || 'دج').toUpperCase()}
            </>
          ) : (
            'قد تستغرق العملية بضع ثوانٍ، لا تغلق هذه الصفحة.'
          )}
        </p>
      </div>
    );
  }

  if (state === 'failed' || state === 'canceled') {
    return (
      <div className="text-center space-y-4 max-w-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-bold">لم تكتمل عملية الدفع</h1>
        <p className="text-sm text-muted-foreground">
          {state === 'canceled' ? 'تم إلغاء عملية الدفع.' : 'فشلت عملية الدفع، لم يتم خصم أي مبلغ.'}
        </p>
        <Link
          href="/buy"
          className="inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          حاول مرة أخرى
        </Link>
      </div>
    );
  }

  // paid
  return (
    <div className="text-center space-y-5 max-w-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10">
        <Check className="h-7 w-7 text-green-500" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-xl font-bold">تم الدفع بنجاح 🎉</h1>
        {data?.planName && (
          <p className="mt-1 text-sm text-muted-foreground">
            باقة <strong>{data.planName}</strong> — {data.amount?.toLocaleString('fr-DZ')}{' '}
            {(data.currency || 'دج').toUpperCase()}
          </p>
        )}
      </div>

      {data?.code ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <p className="text-xs text-muted-foreground">كود التفعيل الخاص بك</p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span dir="ltr" className="text-2xl font-extrabold tracking-widest text-primary">
              {data.code}
            </span>
            <button
              type="button"
              onClick={copyCode}
              className="rounded-full border border-border p-2 transition hover:bg-card"
              aria-label="نسخ الكود"
            >
              {copied ? (
                <CopyCheck className="h-4 w-4 text-green-500" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            احتفظ بهذا الكود — لن نعرضه مرة أخرى. استخدمه من التطبيق على تلفزيونك أو موبايلك لتفعيل اشتراكك فوراً.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          تم الدفع، لكن تعذّر عرض الكود هنا. تواصل معنا عبر واتساب وسنرسله لك فوراً.
        </p>
      )}

      <Link
        href="/pair"
        className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        <Tv className="h-4 w-4" aria-hidden="true" />
        تفعيل الجهاز الآن
      </Link>
    </div>
  );
}

export default function BuySuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Suspense
        fallback={
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          </div>
        }
      >
        <SuccessContent />
      </Suspense>
    </main>
  );
}
