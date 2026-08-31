'use client';

import { useLocale } from '@/components/locale-provider';

interface SelectionToolbarProps {
  totalFiltered: number;
  totalUnfiltered: number;
  selectedCount: number;
  onSelectPage: () => void;
  onUnselectPage: () => void;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  isFiltered?: boolean;
}

export default function SelectionToolbar({
  totalFiltered,
  totalUnfiltered,
  selectedCount,
  onSelectPage,
  onUnselectPage,
  onSelectAll,
  onUnselectAll,
  isFiltered,
}: SelectionToolbarProps) {
  const { locale } = useLocale();
  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);
  const showFilteredCount = isFiltered ?? totalFiltered !== totalUnfiltered;

  return (
    <div className="flex items-center justify-between px-1 flex-wrap gap-2">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {L(`${totalFiltered} قناة`, `${totalFiltered} chaînes`, `${totalFiltered} channels`)}
        {showFilteredCount && L(` (من أصل ${totalUnfiltered} بعد التصفية)`, ` (filtrées sur ${totalUnfiltered})`, ` (filtered from ${totalUnfiltered})`)} ·{' '}
        <span className="text-foreground font-medium">{L(`${selectedCount} محددة`, `${selectedCount} sélectionnés`, `${selectedCount} selected`)}</span>
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onSelectPage}
          className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80 font-medium transition-colors"
        >
          {L('تحديد الصفحة', 'Sélectionner la page', 'Select Page')}
        </button>
        <button
          onClick={onUnselectPage}
          className="text-xs uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          {L('إلغاء الصفحة', 'Désélectionner la page', 'Unselect Page')}
        </button>
        <span className="w-px h-4 bg-border" />
        <button
          onClick={onSelectAll}
          className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80 font-medium transition-colors"
        >
          {L(`تحديد الكل (${totalFiltered})`, `Tout sélectionner (${totalFiltered})`, `Select All (${totalFiltered})`)}
        </button>
        <button
          onClick={onUnselectAll}
          className="text-xs uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          {L('إلغاء الكل', 'Tout désélectionner', 'Unselect All')}
        </button>
      </div>
    </div>
  );
}
