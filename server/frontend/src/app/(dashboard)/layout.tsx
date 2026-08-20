'use client';

import { useRequireAuth } from '@/hooks/use-auth';
import { StreamPlayerProvider } from '@/components/stream-player-context';
import { ErrorBoundary } from '@/components/error-boundary';
import { ToastProvider } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useRequireAuth();

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="brand-surface flex w-full max-w-sm flex-col items-center rounded-3xl border border-border/70 px-6 py-10 text-center shadow-sm">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="mt-4 font-medium">جارٍ التحقق من صلاحية الوصول</p>
          <p className="mt-1 text-sm text-muted-foreground">سيتم نقلك إلى لوحة التحكم أو صفحة تسجيل الدخول تلقائيًا.</p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <StreamPlayerProvider>
        <ErrorBoundary>{children}</ErrorBoundary>
      </StreamPlayerProvider>
    </ToastProvider>
  );
}
