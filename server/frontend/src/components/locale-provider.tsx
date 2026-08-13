'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Locale = 'ar' | 'en' | 'fr';

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  ar: {
    'nav.dashboard': 'لوحة التحكم',
    'nav.quickPick': 'اختيار سريع',
    'nav.channels': 'القنوات المباشرة',
    'nav.movies': 'الأفلام (VOD)',
    'nav.series': 'المسلسلات',
    'nav.users': 'المستخدمون',
    'nav.devices': 'الأجهزة',
    'nav.plans': 'الباقات',
    'nav.codes': 'أكواد التفعيل',
    'nav.import': 'استيراد IPTV',
    'nav.m3uSources': 'مصادر M3U التلقائية',
    'nav.xtreamSources': 'مصادر Xtream',
    'nav.sources': 'مصادر أخرى',
    'nav.epg': 'دليل البرامج (EPG)',
    'nav.versions': 'إصدارات التطبيق',
    'nav.stats': 'الإحصائيات',
    'nav.activity': 'سجل النشاط',
    'nav.scheduler': 'جدول المهام',
    'nav.settings': 'الإعدادات',
    'nav.myChannels': 'قنواتي',
    'nav.pairDevice': 'ربط الجهاز',
    'nav.subscription': 'الاشتراك',
    'nav.profile': 'الملف الشخصي',
    'language.label': 'اللغة',
    'language.ar': 'العربية',
    'language.en': 'English',
    'language.fr': 'Français',
    'header.openNavigation': 'فتح قائمة التنقل',
    'header.lightMode': 'الوضع الفاتح',
    'header.darkMode': 'الوضع الداكن',
    'header.logout': 'تسجيل الخروج',
    'common.loading': 'جارٍ التحميل…',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.quickPick': 'Quick pick',
    'nav.channels': 'Live channels',
    'nav.movies': 'Movies (VOD)',
    'nav.series': 'Series',
    'nav.users': 'Users',
    'nav.devices': 'Devices',
    'nav.plans': 'Plans',
    'nav.codes': 'Activation codes',
    'nav.import': 'IPTV import',
    'nav.m3uSources': 'Automatic M3U sources',
    'nav.xtreamSources': 'Xtream sources',
    'nav.sources': 'Other sources',
    'nav.epg': 'Programme guide (EPG)',
    'nav.versions': 'App releases',
    'nav.stats': 'Statistics',
    'nav.activity': 'Activity log',
    'nav.scheduler': 'Task scheduler',
    'nav.settings': 'Settings',
    'nav.myChannels': 'My channels',
    'nav.pairDevice': 'Pair device',
    'nav.subscription': 'Subscription',
    'nav.profile': 'Profile',
    'language.label': 'Language',
    'language.ar': 'العربية',
    'language.en': 'English',
    'language.fr': 'Français',
    'header.openNavigation': 'Open navigation',
    'header.lightMode': 'Switch to light mode',
    'header.darkMode': 'Switch to dark mode',
    'header.logout': 'Log out',
    'common.loading': 'Loading…',
  },
  fr: {
    'nav.dashboard': 'Tableau de bord',
    'nav.quickPick': 'Sélection rapide',
    'nav.channels': 'Chaînes en direct',
    'nav.movies': 'Films (VOD)',
    'nav.series': 'Séries',
    'nav.users': 'Utilisateurs',
    'nav.devices': 'Appareils',
    'nav.plans': 'Forfaits',
    'nav.codes': "Codes d’activation",
    'nav.import': 'Import IPTV',
    'nav.m3uSources': 'Sources M3U automatiques',
    'nav.xtreamSources': 'Sources Xtream',
    'nav.sources': 'Autres sources',
    'nav.epg': 'Guide des programmes (EPG)',
    'nav.versions': 'Versions de l’application',
    'nav.stats': 'Statistiques',
    'nav.activity': 'Journal d’activité',
    'nav.scheduler': 'Planificateur de tâches',
    'nav.settings': 'Paramètres',
    'nav.myChannels': 'Mes chaînes',
    'nav.pairDevice': 'Associer un appareil',
    'nav.subscription': 'Abonnement',
    'nav.profile': 'Profil',
    'language.label': 'Langue',
    'language.ar': 'العربية',
    'language.en': 'English',
    'language.fr': 'Français',
    'header.openNavigation': 'Ouvrir la navigation',
    'header.lightMode': 'Passer au thème clair',
    'header.darkMode': 'Passer au thème sombre',
    'header.logout': 'Se déconnecter',
    'common.loading': 'Chargement…',
  },
};

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ar');

  useEffect(() => {
    const stored = window.localStorage.getItem('dzhoof-locale');
    if (stored === 'ar' || stored === 'en' || stored === 'fr') setLocaleState(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('dzhoof-locale', locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: (nextLocale) => setLocaleState(nextLocale),
    t: (key) => dictionaries[locale][key] ?? dictionaries.en[key] ?? key,
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}

export type { Locale };
