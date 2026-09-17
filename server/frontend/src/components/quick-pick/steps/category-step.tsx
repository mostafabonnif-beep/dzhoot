'use client';

import { useState } from 'react';

const CATEGORIES = [
  // Prominent — shown by default
  { id: 'news', label: 'أخبار' },
  { id: 'sports', label: 'رياضة' },
  { id: 'entertainment', label: 'ترفيه' },
  { id: 'movies', label: 'أفلام' },
  { id: 'kids', label: 'أطفال' },
  { id: 'music', label: 'موسيقى' },
  { id: 'documentary', label: 'وثائقيات' },
  { id: 'general', label: 'عام' },
  // Extended
  { id: 'animation', label: 'رسوم متحركة' },
  { id: 'comedy', label: 'كوميديا' },
  { id: 'cooking', label: 'طبخ' },
  { id: 'culture', label: 'ثقافة' },
  { id: 'education', label: 'تعليم' },
  { id: 'family', label: 'عائلة' },
  { id: 'lifestyle', label: 'نمط حياة' },
  { id: 'religious', label: 'دينية' },
  { id: 'science', label: 'علوم' },
  { id: 'series', label: 'مسلسلات' },
  { id: 'travel', label: 'سفر' },
  { id: 'weather', label: 'طقس' },
  { id: 'business', label: 'أعمال' },
  { id: 'classic', label: 'كلاسيكيات' },
  { id: 'outdoor', label: 'هواء طلق' },
  { id: 'relax', label: 'استرخاء' },
  { id: 'shop', label: 'تسوق' },
  { id: 'auto', label: 'سيارات' },
  { id: 'legislative', label: 'برلمانية' },
];

const PROMINENT_COUNT = 8;

interface CategoryStepProps {
  selectedCategories: string[];
  onToggleCategory: (id: string) => void;
}

export function CategoryStep({ selectedCategories, onToggleCategory }: CategoryStepProps) {
  const [showAll, setShowAll] = useState(false);

  const displayed = showAll ? CATEGORIES : CATEGORIES.slice(0, PROMINENT_COUNT);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">الخطوة 4</p>
        <h2 className="text-base font-display font-bold uppercase tracking-[0.08em]">
          اختر الفئات
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          ما نوع القنوات التي تبحث عنها؟ تخطَّ لعرض الكل.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="اختيار الفئات">
        {displayed.map((cat) => {
          const isSelected = selectedCategories.includes(cat.id);
          return (
            <button
              key={cat.id}
              onClick={() => onToggleCategory(cat.id)}
              aria-pressed={isSelected}
              className={`px-4 py-2.5 text-sm border-2 transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {!showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-primary hover:text-primary/80 uppercase tracking-[0.1em] font-medium"
        >
          عرض كل الفئات ({CATEGORIES.length - PROMINENT_COUNT} إضافية)
        </button>
      )}

      {selectedCategories.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selectedCategories.length} فئة محددة
        </p>
      )}
    </div>
  );
}
