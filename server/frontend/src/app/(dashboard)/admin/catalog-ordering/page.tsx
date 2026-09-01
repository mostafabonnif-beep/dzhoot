'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Globe,
  Layers,
  ListOrdered,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/hooks/use-toast';

interface CountryOption {
  code: string;
  label: string;
}

interface OrderingState {
  countryPriority: { value: string[]; source: 'db' | 'env' };
  categoryPriority: { value: string[]; source: 'db' | 'env' };
}

interface OrderingData {
  countryPriority: { value: string[]; source: 'db' | 'env' };
  categoryPriority: { value: string[]; source: 'db' | 'env' };
  availableCountries: CountryOption[];
  availableCategories: string[];
}

const CATEGORY_PRESETS = [
  { label: 'رياضة → أفلام → أطفال → أخبار', value: ['رياضة', 'أفلام ومسلسلات', 'أطفال', 'أخبار', 'وثائقي', 'ترفيه', 'موسيقى', 'ديني', 'عام'] },
  { label: 'ترتيب المورد (بدون تخصيص)', value: [] },
];

const COUNTRY_PRESETS = [
  { label: 'الجزائر أولاً 🇩🇿', value: ['DZ', 'AR', 'MA', 'TN', 'LY', 'EG', 'SA', 'AE', 'QA', 'FR', 'UK', 'US', 'CA'] },
  { label: 'المغرب العربي', value: ['DZ', 'MA', 'TN', 'LY', 'AR'] },
  { label: 'العالم العربي كاملًا', value: ['DZ', 'AR', 'EG', 'SA', 'AE', 'QA', 'MA', 'TN', 'LY', 'IQ', 'IR'] },
  { label: 'فرنسا وأوروبا', value: ['FR', 'UK', 'DE', 'ES', 'IT', 'EU'] },
  { label: 'ترتيب المورد (بدون تخصيص)', value: [] },
];

export default function CatalogOrderingPage() {
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [data, setData] = useState<OrderingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [countryOrder, setCountryOrder] = useState<string[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const L = useCallback(
    (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en),
    [locale],
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/catalog-ordering');
      if (res.data?.success) {
        setData(res.data.data);
        setCountryOrder(res.data.data.countryPriority.value ?? []);
        setCategoryOrder(res.data.data.categoryPriority.value ?? []);
      } else {
        setError(res.data?.error || 'Error');
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const move = (list: string[], index: number, dir: -1 | 1): string[] => {
    const next = [...list];
    const target = index + dir;
    if (target < 0 || target >= next.length) return next;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };

  const addCountry = (code: string) => {
    if (!countryOrder.includes(code)) setCountryOrder([...countryOrder, code]);
  };
  const removeCountry = (code: string) => setCountryOrder(countryOrder.filter((c) => c !== code));
  const addCategory = (cat: string) => {
    if (!categoryOrder.includes(cat)) setCategoryOrder([...categoryOrder, cat]);
  };
  const removeCategory = (cat: string) => setCategoryOrder(categoryOrder.filter((c) => c !== cat));

  const countryLabel = (code: string) =>
    data?.availableCountries.find((c) => c.code === code)?.label || code;

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const res = await api.put('/admin/catalog-ordering', {
        countryPriority: countryOrder,
        categoryPriority: categoryOrder,
      });
      if (res.data?.success) {
        setData((prev) => (prev ? { ...prev, ...res.data.data } : prev));
        setSavedAt(new Date().toISOString());
        toast(
          `${L('تم الحفظ ✓', 'Enregistré ✓', 'Saved ✓')} — ${L(
            'سيظهر الترتيب الجديد فورًا في قوائم الزبائن (التطبيق والويب).',
            'Le nouvel ordre s’applique immédiatement aux listes clients.',
            'The new order applies immediately to customer lists.',
          )}`,
          'success',
        );
      } else {
        setError(res.data?.error || 'Error');
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const countrySource = data?.countryPriority.source === 'db'
    ? L('من اللوحة', 'depuis le panneau', 'from the panel')
    : data?.countryPriority.source === 'env'
      ? L('من متغيرات البيئة', 'des variables d’environnement', 'from environment variables')
      : L('غير مفعّل (ترتيب المورد)', 'désactivé (ordre fournisseur)', 'off (supplier order)');

  const categorySource = data?.categoryPriority.source === 'db'
    ? L('من اللوحة', 'depuis le panneau', 'from the panel')
    : data?.categoryPriority.source === 'env'
      ? L('من متغيرات البيئة', 'des variables d’environnement', 'from environment variables')
      : L('غير مفعّل (ترتيب المورد)', 'désactivé (ordre fournisseur)', 'off (supplier order)');

  const availableCountries = (data?.availableCountries || []).filter((c) => !countryOrder.includes(c.code));
  const availableCategories = (data?.availableCategories || []).filter((c) => !categoryOrder.includes(c));

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-20 justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{L('جارٍ التحميل...', 'Chargement…', 'Loading…')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">
            {L('تنظيم القوائم', 'Organisation des listes', 'Channel list ordering')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {L(
              'رتب قنوات الزبائن كما تريد: الدولة أولاً، ثم الفئة، ثم ترتيب المورد — ويتطبق فورًا على التطبيق والويب.',
              'Classez les chaînes clients comme vous voulez : pays d’abord, puis catégorie, puis ordre fournisseur.',
              'Order customer channels your way: country first, then category, then supplier order.',
            )}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-[0.1em] font-medium border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? L('جارٍ الحفظ...', 'Enregistrement…', 'Saving…') : L('حفظ الترتيب', 'Enregistrer', 'Save order')}
        </button>
      </div>

      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {savedAt && !error && (
        <div className="border border-signal-green/40 bg-signal-green/10 px-4 py-3 text-sm flex items-center gap-2">
          <Check className="h-4 w-4 text-signal-green" />
          <span>
            {L('تم تطبيق الترتيب — قائمة الزبائن تُعرض الآن بالترتيب الجديد', 'Ordre appliqué — les listes clients utilisent le nouvel ordre', 'Order applied — customer lists now use the new order')}
          </span>
        </div>
      )}

      {/* Countries */}
      <div className="border border-border">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            {L('أولوية الدول', 'Priorité des pays', 'Country priority')}
          </h2>
          <span className="text-xs text-muted-foreground">{countrySource}</span>
        </div>
        <div className="p-4 space-y-4">
          {countryOrder.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {L(
                'بدون تخصيص — القنوات تظهر بترتيب المورد الأصلي.',
                'Aucune personnalisation — ordre fournisseur d’origine.',
                'No override — channels appear in the supplier’s original order.',
              )}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {countryOrder.map((code, i) => (
                <div key={code} className="flex items-center gap-1 border border-border px-2 py-1">
                  <span className="text-sm">{countryLabel(code)}</span>
                  <button
                    onClick={() => setCountryOrder(move(countryOrder, i, -1))}
                    disabled={i === 0}
                    aria-label={`Move ${code} up`}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setCountryOrder(move(countryOrder, i, 1))}
                    disabled={i === countryOrder.length - 1}
                    aria-label={`Move ${code} down`}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeCountry(code)}
                    aria-label={`Remove ${code}`}
                    className="p-0.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {availableCountries.map((c) => (
              <button
                key={c.code}
                onClick={() => addCountry(c.code)}
                className="px-2 py-0.5 text-xs border border-border/60 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
              >
                + {c.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {L('جاهز:', 'Préréglages :', 'Presets:')}
            </span>
            {COUNTRY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setCountryOrder(preset.value)}
                className="px-2 py-0.5 text-xs border border-border hover:bg-accent transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="border border-border">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.15em] flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            {L('أولوية الفئات', 'Priorité des catégories', 'Category priority')}
          </h2>
          <span className="text-xs text-muted-foreground">{categorySource}</span>
        </div>
        <div className="p-4 space-y-4">
          {categoryOrder.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {L('بدون تخصيص — الفئات تظهر بترتيب المورد.', 'Aucune personnalisation.', 'No override — supplier category order.')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categoryOrder.map((cat, i) => (
                <div key={cat} className="flex items-center gap-1 border border-border px-2 py-1">
                  <span className="text-sm">{cat}</span>
                  <button
                    onClick={() => setCategoryOrder(move(categoryOrder, i, -1))}
                    disabled={i === 0}
                    aria-label={`Move ${cat} up`}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setCategoryOrder(move(categoryOrder, i, 1))}
                    disabled={i === categoryOrder.length - 1}
                    aria-label={`Move ${cat} down`}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeCategory(cat)}
                    aria-label={`Remove ${cat}`}
                    className="p-0.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {availableCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => addCategory(cat)}
                className="px-2 py-0.5 text-xs border border-border/60 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
              >
                + {cat}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {L('جاهز:', 'Préréglages :', 'Presets:')}
            </span>
            {CATEGORY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setCategoryOrder(preset.value)}
                className="px-2 py-0.5 text-xs border border-border hover:bg-accent transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="border border-border/60 p-4">
        <div className="flex items-center gap-2 mb-2">
          <ListOrdered className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-[0.15em]">
            {L('الترتيب النهائي للقوائم', 'Ordre final des listes', 'Final list order')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          {countryOrder.length > 0 && (
            <>
              <span className="text-foreground font-medium">
                {L('الدول: ', 'Pays : ', 'Countries: ')}
              </span>
              {countryOrder.map(countryLabel).join(' ← ')}
              {' · '}
            </>
          )}
          {categoryOrder.length > 0 && (
            <>
              <span className="text-foreground font-medium">
                {L('الفئات: ', 'Catégories : ', 'Categories: ')}
              </span>
              {categoryOrder.join(' ← ')}
              {' · '}
            </>
          )}
          {L(
            'ثم باقي الدول/الفئات بترتيب المورد، وضمن كل فئة يبقى ترتيب القناة الأصلي كما هو.',
            'Puis le reste dans l’ordre fournisseur ; l’ordre interne de chaque catégorie est préservé.',
            'Then the rest in supplier order; within each group the supplier’s own channel order is preserved.',
          )}
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <RotateCcw className="h-3 w-3" />
          {L(
            'عند إضافة مصدر جديد أو مزامنته، يبقى هذا الترتيب ثابتًا — القائمة لا تتغير، والمصدر الجديد يُربط تلقائيًا كمصدر احتياطي.',
            'Lors de l’ajout d’une nouvelle source, cet ordre reste stable — la liste ne bouge pas.',
            'When adding or syncing a new source, this order stays stable — the list never moves.',
          )}
        </div>
      </div>
    </div>
  );
}
