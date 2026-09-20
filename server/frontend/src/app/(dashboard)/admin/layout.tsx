import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import { RoleGuard } from '@/components/role-guard';

// Distinguishes the admin and user sections in the tab/share title; the root
// layout appends the brand via `title.template`. Per-page titles inside each
// section are a follow-up.
export const metadata: Metadata = {
  title: 'لوحة الإدارة',
  description: 'إدارة المصادر والقنوات والأكواد والمستخدمين في منصة DZ HOOF.',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="Admin">
      <AppShell role="admin">{children}</AppShell>
    </RoleGuard>
  );
}
