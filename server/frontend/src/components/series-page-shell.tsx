'use client';

import { Tv } from 'lucide-react';
import VodAdminShell from '@/components/vod-admin-shell';

export default function SeriesPageShell() {
  return (
    <VodAdminShell
      kind="series"
      title="إدارة المسلسلات"
      totalLabel="إجمالي المسلسلات المتاحة"
      searchPlaceholder="ابحث عن اسم المسلسل..."
      emptyLabel="لا توجد مسلسلات مطابقة للبحث."
      loadErrorLabel="تعذر تحميل المسلسلات حاليًا. تحقق من الاتصال ثم أعد المحاولة."
      icon={<Tv className="h-6 w-6 text-primary" />}
    />
  );
}
