'use client';

import { Film } from 'lucide-react';
import VodAdminShell from '@/components/vod-admin-shell';

export default function MoviesPageShell() {
  return (
    <VodAdminShell
      kind="movies"
      title="إدارة الأفلام (VOD)"
      totalLabel="إجمالي الأفلام المتاحة"
      searchPlaceholder="ابحث عن اسم الفيلم..."
      emptyLabel="لا توجد أفلام مطابقة للبحث."
      loadErrorLabel="تعذر تحميل الأفلام حاليًا. تحقق من الاتصال ثم أعد المحاولة."
      icon={<Film className="h-6 w-6 text-primary" />}
    />
  );
}
