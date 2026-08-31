'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import type { SourceType } from '../wizard-shell';

// Common countries for IPTV-org (no dedicated API)
const IPTV_ORG_COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' },
  { code: 'RU', name: 'Russia' },
  { code: 'TR', name: 'Turkey' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'AE', name: 'UAE' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'EG', name: 'Egypt' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'PL', name: 'Poland' },
];

const COUNTRY_NAMES_AR: Record<string, string> = {
  IN: 'الهند', US: 'الولايات المتحدة', GB: 'المملكة المتحدة', CA: 'كندا', AU: 'أستراليا',
  DE: 'ألمانيا', FR: 'فرنسا', ES: 'إسبانيا', IT: 'إيطاليا', BR: 'البرازيل', MX: 'المكسيك',
  AR: 'الأرجنتين', JP: 'اليابان', KR: 'كوريا الجنوبية', CN: 'الصين', RU: 'روسيا', TR: 'تركيا',
  SA: 'السعودية', AE: 'الإمارات', PK: 'باكستان', BD: 'بنغلاديش', ID: 'إندونيسيا', TH: 'تايلاند',
  PH: 'الفلبين', NG: 'نيجيريا', ZA: 'جنوب أفريقيا', EG: 'مصر', NL: 'هولندا', SE: 'السويد', PL: 'بولندا',
};

interface Region {
  code: string;
  name: string;
  nameAr?: string;
  channelCount?: number;
}

const SOURCE_LABELS: Record<string, string> = {
  'iptv-org': 'IPTV-org',
  'pluto-tv': 'Pluto TV',
  'samsung-tv-plus': 'Samsung TV Plus',
};

interface CountryStepProps {
  selectedSources: SourceType[];
  countrySelections: Record<string, string>;
  onSetCountry: (source: SourceType, country: string) => void;
}

export function CountryStep({
  selectedSources,
  countrySelections,
  onSetCountry,
}: CountryStepProps) {
  const { t, locale } = useLocale();
  const [regions, setRegions] = useState<Record<string, Region[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchRegions() {
      setLoading(true);
      const result: Record<string, Region[]> = {};

      const promises: Promise<void>[] = [];

      if (selectedSources.includes('iptv-org')) {
        result['iptv-org'] = IPTV_ORG_COUNTRIES.map((region) => ({
          ...region,
          nameAr: COUNTRY_NAMES_AR[region.code],
        }));
      }

      if (selectedSources.includes('pluto-tv')) {
        promises.push(
          api
            .get('/external-sources/pluto-tv/regions')
            .then((res) => {
              result['pluto-tv'] = res.data.data || [];
            })
            .catch(() => {
              result['pluto-tv'] = [];
            }),
        );
      }

      if (selectedSources.includes('samsung-tv-plus')) {
        promises.push(
          api
            .get('/external-sources/samsung-tv-plus/regions')
            .then((res) => {
              result['samsung-tv-plus'] = res.data.data || [];
            })
            .catch(() => {
              result['samsung-tv-plus'] = [];
            }),
        );
      }

      await Promise.allSettled(promises);
      setRegions(result);
      setLoading(false);
    }
    fetchRegions();
  }, [selectedSources]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">{t('quickPick.step2')}</p>
        <h2 className="text-base font-display font-bold uppercase tracking-[0.08em]">
          {t('quickPick.selectCountry')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('quickPick.countryDescription')}
        </p>
      </div>

      {selectedSources.map((source) => {
        const sourceRegions = regions[source] || [];
        const search = searchTerms[source] || '';
        const filtered = search
          ? sourceRegions.filter(
              (r) =>
                r.name.toLowerCase().includes(search.toLowerCase()) ||
                r.nameAr?.toLowerCase().includes(search.toLowerCase()) ||
                r.code.toLowerCase().includes(search.toLowerCase()),
            )
          : sourceRegions;
        const selected = countrySelections[source] || '';

        return (
          <div key={source} className="space-y-2">
            <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {SOURCE_LABELS[source]}
            </h3>

            {sourceRegions.length > 8 && (
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t('quickPick.searchCountries')}
                  aria-label={t('quickPick.searchCountries')}
                  value={search}
                  onChange={(e) =>
                    setSearchTerms((prev) => ({ ...prev, [source]: e.target.value }))
                  }
                  className="w-full ps-9 pe-3 py-2 text-sm border border-border bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
            )}

            <div
              className="flex flex-wrap gap-1.5 max-h-[200px] overflow-y-auto"
              role="group"
              aria-label={`${SOURCE_LABELS[source]} — ${t('quickPick.selectSourceCountry')}`}
            >
              {filtered.map((r) => {
                const isActive = selected === r.code;
                return (
                  <button
                    key={r.code}
                    onClick={() => onSetCountry(source, isActive ? '' : r.code)}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs border transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-card hover:border-primary/40'
                    }`}
                  >
                    {locale === 'ar' && r.nameAr ? r.nameAr : r.name}
                    {r.channelCount != null && (
                      <span className="text-muted-foreground">({r.channelCount})</span>
                    )}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">{t('quickPick.noRegions')}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
