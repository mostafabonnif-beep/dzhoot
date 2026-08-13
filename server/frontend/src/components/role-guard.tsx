'use client';

import { useRequireAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/locale-provider';

export function RoleGuard({
  role,
  children,
}: {
  role: 'Admin' | 'User';
  children: React.ReactNode;
}) {
  const { user, isAuthenticated, isLoading } = useRequireAuth(role);
  const { t } = useLocale();

  if (isLoading || !isAuthenticated || user?.role !== role) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  return <>{children}</>;
}
