'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html dir="rtl" lang="ar">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#070D0A',
          color: '#EAF3EE',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: '0 auto 1.25rem',
              borderRadius: 16,
              background: 'linear-gradient(135deg,#0E7A3E,#128C4A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
            }}
          >
            ⚠️
          </div>
          <h2 style={{ margin: '0 0 .5rem', fontSize: '1.4rem', fontWeight: 700 }}>
            حدث خطأ غير متوقع
          </h2>
          <p style={{ margin: '0 0 1.5rem', color: '#9FB3A8', lineHeight: 1.7 }}>
            عذراً، واجه التطبيق مشكلة. تم إبلاغ الفريق تلقائياً — حاول مرة أخرى أو أعد تحميل الصفحة.
          </p>
          <button
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: 9999,
              background: '#128C4A',
              color: '#fff',
              padding: '.75rem 2rem',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
