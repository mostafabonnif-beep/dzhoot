'use client';

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';

// Common languages with 3-letter codes (matching IPTV-org format)
const ALL_LANGUAGES = [
  // Prominent — shown first
  { code: 'eng', name: 'English' },
  { code: 'hin', name: 'Hindi' },
  { code: 'spa', name: 'Spanish' },
  { code: 'fra', name: 'French' },
  { code: 'deu', name: 'German' },
  { code: 'por', name: 'Portuguese' },
  { code: 'ara', name: 'Arabic' },
  { code: 'rus', name: 'Russian' },
  { code: 'jpn', name: 'Japanese' },
  { code: 'kor', name: 'Korean' },
  { code: 'zho', name: 'Chinese' },
  { code: 'ita', name: 'Italian' },
  // Extended
  { code: 'tur', name: 'Turkish' },
  { code: 'nld', name: 'Dutch' },
  { code: 'pol', name: 'Polish' },
  { code: 'swe', name: 'Swedish' },
  { code: 'tam', name: 'Tamil' },
  { code: 'tel', name: 'Telugu' },
  { code: 'ben', name: 'Bengali' },
  { code: 'mar', name: 'Marathi' },
  { code: 'guj', name: 'Gujarati' },
  { code: 'kan', name: 'Kannada' },
  { code: 'mal', name: 'Malayalam' },
  { code: 'pan', name: 'Punjabi' },
  { code: 'urd', name: 'Urdu' },
  { code: 'tha', name: 'Thai' },
  { code: 'vie', name: 'Vietnamese' },
  { code: 'ind', name: 'Indonesian' },
  { code: 'msa', name: 'Malay' },
  { code: 'fil', name: 'Filipino' },
  { code: 'ron', name: 'Romanian' },
  { code: 'ces', name: 'Czech' },
  { code: 'ell', name: 'Greek' },
  { code: 'hun', name: 'Hungarian' },
  { code: 'heb', name: 'Hebrew' },
  { code: 'fas', name: 'Persian' },
  { code: 'ukr', name: 'Ukrainian' },
  { code: 'cat', name: 'Catalan' },
  { code: 'nor', name: 'Norwegian' },
  { code: 'dan', name: 'Danish' },
  { code: 'fin', name: 'Finnish' },
];

const PROMINENT_COUNT = 12;

const LANG_NAMES_AR: Record<string, string> = {
  eng: 'الإنجليزية', hin: 'الهندية', spa: 'الإسبانية', fra: 'الفرنسية', deu: 'الألمانية',
  por: 'البرتغالية', ara: 'العربية', rus: 'الروسية', jpn: 'اليابانية', kor: 'الكورية',
  zho: 'الصينية', ita: 'الإيطالية', tur: 'التركية', nld: 'الهولندية', pol: 'البولندية',
  swe: 'السويدية', tam: 'التاميلية', tel: 'التيلوغوية', ben: 'البنغالية', mar: 'الماراثية',
  guj: 'الغوجاراتية', kan: 'الكنادية', mal: 'المالايالامية', pan: 'البنجابية', urd: 'الأردية',
  tha: 'التايلاندية', vie: 'الفيتنامية', ind: 'الإندونيسية', msa: 'الملايوية', fil: 'الفلبينية',
  ron: 'الرومانية', ces: 'التشيكية', ell: 'اليونانية', hun: 'المجرية', heb: 'العبرية',
  fas: 'الفارسية', ukr: 'الأوكرانية', cat: 'الكتالانية', nor: 'النرويجية', dan: 'الدنماركية',
  fin: 'الفنلندية',
};

interface LanguageStepProps {
  selectedLanguages: string[];
  onToggleLanguage: (code: string) => void;
}

export function LanguageStep({ selectedLanguages, onToggleLanguage }: LanguageStepProps) {
  const { t, locale } = useLocale();
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const list = showAll ? ALL_LANGUAGES : ALL_LANGUAGES.slice(0, PROMINENT_COUNT);
    if (!search) return list;
    return ALL_LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        LANG_NAMES_AR[l.code]?.includes(search) ||
        l.code.toLowerCase().includes(search.toLowerCase()),
    );
  }, [search, showAll]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">{t('quickPick.step3')}</p>
        <h2 className="text-base font-display font-bold uppercase tracking-[0.08em]">
          {t('quickPick.preferredLanguages')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('quickPick.languageDescription')}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('quickPick.searchLanguages')}
          aria-label={t('quickPick.searchLanguages')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (e.target.value) setShowAll(true);
          }}
          className="w-full ps-9 pe-3 py-2 text-sm border border-border bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('quickPick.selectLanguage')}>
        {filtered.map((lang) => {
          const isSelected = selectedLanguages.includes(lang.code);
          return (
            <button
              key={lang.code}
              onClick={() => onToggleLanguage(lang.code)}
              aria-pressed={isSelected}
              className={`px-3 py-2 text-xs border transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              {locale === 'ar' && LANG_NAMES_AR[lang.code] ? LANG_NAMES_AR[lang.code] : lang.name}
            </button>
          );
        })}
      </div>

      {!showAll && !search && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-primary hover:text-primary/80 uppercase tracking-[0.1em] font-medium"
        >
          {t('quickPick.showAllLanguages')} ({ALL_LANGUAGES.length - PROMINENT_COUNT} {t('quickPick.more')})
        </button>
      )}

      {selectedLanguages.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selectedLanguages.length} {t('quickPick.selectedLanguages')}
        </p>
      )}
    </div>
  );
}
