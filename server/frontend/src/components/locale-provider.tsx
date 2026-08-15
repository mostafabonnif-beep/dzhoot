'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Locale = 'ar' | 'en' | 'fr';
type Dictionary = Record<string, string>;

const common = {
  'common.loading': ['جارٍ التحميل…', 'Loading…', 'Chargement…'],
  'common.save': ['حفظ', 'Save', 'Enregistrer'],
  'common.cancel': ['إلغاء', 'Cancel', 'Annuler'],
  'common.close': ['إغلاق', 'Close', 'Fermer'],
  'common.create': ['إنشاء', 'Create', 'Créer'],
  'common.edit': ['تعديل', 'Edit', 'Modifier'],
  'common.delete': ['حذف', 'Delete', 'Supprimer'],
  'common.search': ['بحث', 'Search', 'Rechercher'],
  'common.refresh': ['تحديث', 'Refresh', 'Actualiser'],
  'common.retry': ['إعادة المحاولة', 'Retry', 'Réessayer'],
  'common.noResults': ['لا توجد نتائج', 'No results', 'Aucun résultat'],
  'common.noData': ['لا توجد بيانات متاحة', 'No data available', 'Aucune donnée disponible'],
  'common.active': ['نشط', 'Active', 'Actif'],
  'common.inactive': ['غير نشط', 'Inactive', 'Inactif'],
  'common.status': ['الحالة', 'Status', 'Statut'],
  'common.name': ['الاسم', 'Name', 'Nom'],
  'common.email': ['البريد الإلكتروني', 'Email', 'E-mail'],
  'common.username': ['اسم المستخدم', 'Username', "Nom d’utilisateur"],
  'common.password': ['كلمة المرور', 'Password', 'Mot de passe'],
  'common.description': ['الوصف', 'Description', 'Description'],
  'common.actions': ['الإجراءات', 'Actions', 'Actions'],
  'common.confirm': ['تأكيد', 'Confirm', 'Confirmer'],
  'common.copied': ['تم النسخ', 'Copied', 'Copié'],
  'common.copy': ['نسخ', 'Copy', 'Copier'],
  'common.clear': ['مسح', 'Clear', 'Effacer'],
  'common.all': ['الكل', 'All', 'Tous'],
  'common.days': ['يوم', 'days', 'jours'],
  'common.devices': ['أجهزة', 'devices', 'appareils'],
  'common.error': ['حدث خطأ', 'An error occurred', 'Une erreur est survenue'],
  'common.success': ['تمت العملية بنجاح', 'Operation completed successfully', 'Opération réussie'],
  'channels.confirmDelete': ['هل تريد حذف هذه القناة؟', 'Delete this channel?', 'Supprimer cette chaîne ?'],
  'channels.confirmRemoveAll': ['هل تريد إزالة جميع القنوات من قائمتك؟', 'Remove all channels from your list?', 'Supprimer toutes les chaînes de votre liste ?'],
  'channels.deleteFailed': ['فشل حذف القناة', 'Failed to delete channel', 'Échec de suppression de la chaîne'],
  'channels.removeFailed': ['فشلت إزالة القناة', 'Failed to remove channel', 'Échec de retrait de la chaîne'],
  'channels.deleteAllFailed': ['فشل حذف جميع القنوات', 'Failed to delete all channels', 'Échec de suppression de toutes les chaînes'],
  'channels.clearFailed': ['فشل مسح القنوات', 'Failed to clear channels', 'Échec de vidage des chaînes'],
  'admin.dashboard': ['لوحة التحكم', 'Dashboard', 'Tableau de bord'],
  'admin.users': ['المستخدمون', 'Users', 'Utilisateurs'],
  'admin.plans': ['الباقات', 'Plans', 'Forfaits'],
  'admin.codes': ['أكواد التفعيل', 'Activation codes', "Codes d’activation"],
  'admin.stats': ['الإحصائيات', 'Statistics', 'Statistiques'],
  'admin.total': ['الإجمالي', 'Total', 'Total'],
  'admin.registeredUsers': ['المستخدمون المسجلون', 'Registered users', 'Utilisateurs inscrits'],
  'admin.newUser': ['مستخدم جديد', 'New user', 'Nouvel utilisateur'],
  'admin.newPlan': ['باقة جديدة', 'New plan', 'Nouveau forfait'],
  'admin.generateCodes': ['إنشاء أكواد', 'Generate codes', 'Générer des codes'],
  'admin.searchUsers': ['البحث عن مستخدمين', 'Search users', 'Rechercher des utilisateurs'],
  'admin.searchPlaceholder': ['ابحث باسم المستخدم أو البريد أو رمز القناة…', 'Search by username, email, or channel code…', "Rechercher par nom d’utilisateur, e-mail ou code chaîne…"],
  'plans.duration': ['المدة', 'Duration', 'Durée'],
  'plans.maxDevices': ['الحد الأقصى للأجهزة', 'Maximum devices', 'Nombre maximal d’appareils'],
  'plans.days': ['يومًا', 'days', 'jours'],
  'codes.searchPlaceholder': ['ابحث بآخر 4 أرقام…', 'Search by last 4 digits…', 'Rechercher par les 4 derniers chiffres…'],
  'codes.allStatuses': ['كل الحالات', 'All statuses', 'Tous les statuts'],
  'codes.allPlans': ['كل الباقات', 'All plans', 'Tous les forfaits'],
  'codes.unused': ['غير مستخدم', 'Unused', 'Inutilisé'],
  'codes.activated': ['مفعّل', 'Activated', 'Activé'],
  'codes.revoked': ['ملغى', 'Revoked', 'Révoqué'],
  'codes.expired': ['منتهي', 'Expired', 'Expiré'],
  'settings.title': ['الإعدادات', 'Settings', 'Paramètres'],
  'settings.server': ['إعدادات ومعلومات الخادم', 'Server configuration and info', 'Configuration et informations du serveur'],
  'admin.activity': ['سجل النشاط', 'Activity log', 'Journal d’activité'],
  'admin.scheduler': ['جدول المهام', 'Scheduler', 'Planificateur'],
  'admin.epg': ['دليل البرامج الإلكتروني', 'Electronic programme guide', 'Guide électronique des programmes'],
  'admin.searchActivity': ['البحث في سجل النشاط…', 'Search activity…', 'Rechercher dans l’activité…'],
  'admin.searchActivityLabel': ['البحث في سجلات النشاط', 'Search activity logs', 'Rechercher dans les journaux'],
  'scheduler.loading': ['جارٍ تحميل المهام…', 'Loading scheduler…', 'Chargement du planificateur…'],
  'scheduler.schedule': ['الجدولة', 'Schedule', 'Planification'],
  'scheduler.nextRun': ['التشغيل القادم', 'Next run', 'Prochaine exécution'],
  'scheduler.lastRun': ['آخر تشغيل', 'Last run', 'Dernière exécution'],
  'scheduler.noRuns': ['لم يتم التشغيل بعد', 'No runs yet', 'Aucune exécution'],
  'scheduler.allTasks': ['كل المهام', 'All tasks', 'Toutes les tâches'],
  'scheduler.error': ['خطأ', 'Error', 'Erreur'],
  'import.title': ['استيراد من IPTV-org', 'Import from IPTV-org', 'Importer depuis IPTV-org'],
  'import.adminDescription': ['استيراد القنوات من iptv-org إلى قاعدة بيانات النظام', 'Import channels from iptv-org to the system database', 'Importer les chaînes depuis iptv-org dans la base système'],
  'import.userDescription': ['جلب القنوات تلقائيًا من iptv-org.github.io', 'Auto-fetch channels from iptv-org.github.io', 'Récupérer automatiquement les chaînes depuis iptv-org.github.io'],
  'import.grouped': ['مجمّعة', 'Grouped', 'Groupées'],
  'import.flat': ['قائمة', 'Flat', 'Liste'],
  'import.clearCache': ['مسح الذاكرة المؤقتة', 'Clear cache', 'Vider le cache'],
  'import.selectRegion': ['اختر المنطقة', 'Select region', 'Sélectionner une région'],
  'import.showAllRegions': ['عرض كل المناطق', 'Show all regions', 'Afficher toutes les régions'],
  'import.showFewerRegions': ['عرض مناطق أقل', 'Show fewer regions', 'Afficher moins de régions'],
  'import.selectPlaylist': ['اختر قائمة تشغيل', 'Select a playlist', 'Sélectionner une playlist'],
  'import.fetching': ['جارٍ جلب القنوات…', 'Fetching channels…', 'Récupération des chaînes…'],
  'import.searchPlaceholder': ['ابحث بالاسم أو المعرّف…', 'Search by name or ID…', 'Rechercher par nom ou identifiant…'],
  'import.replaceExisting': ['استبدال الموجود', 'Replace existing', 'Remplacer l’existant'],
  'import.importing': ['جارٍ الاستيراد…', 'Importing…', 'Importation…'],
  'import.toSystem': ['إلى النظام', 'to system', 'vers le système'],
  'import.toMyList': ['إلى قائمتي', 'to my list', 'vers ma liste'],
  'import.channels': ['قنوات', 'channels', 'chaînes'],
  'import.status': ['الحالة:', 'Status:', 'Statut :'],
  'import.all': ['الكل', 'All', 'Toutes'],
  'import.alive': ['● متاح', '● Alive', '● Actif'],
  'import.dead': ['● متوقف', '● Dead', '● Inactif'],
  'import.unknown': ['● غير معروف', '● Unknown', '● Inconnu'],
} as const;

const navigation: Dictionary = {
  'nav.dashboard': 'لوحة التحكم', 'nav.quickPick': 'اختيار سريع', 'nav.channels': 'القنوات المباشرة',
  'nav.movies': 'الأفلام (VOD)', 'nav.series': 'المسلسلات', 'nav.users': 'المستخدمون', 'nav.devices': 'الأجهزة',
  'nav.plans': 'الباقات', 'nav.codes': 'أكواد التفعيل', 'nav.import': 'استيراد IPTV',
  'nav.m3uSources': 'مصادر M3U التلقائية', 'nav.xtreamSources': 'مصادر Xtream', 'nav.sources': 'مصادر أخرى',
  'nav.epg': 'دليل البرامج (EPG)', 'nav.versions': 'إصدارات التطبيق', 'nav.stats': 'الإحصائيات',
  'nav.activity': 'سجل النشاط', 'nav.scheduler': 'جدول المهام', 'nav.settings': 'الإعدادات',
  'nav.myChannels': 'قنواتي', 'nav.pairDevice': 'ربط الجهاز', 'nav.subscription': 'الاشتراك', 'nav.profile': 'الملف الشخصي',
  'language.label': 'اللغة', 'language.ar': 'العربية', 'language.en': 'English', 'language.fr': 'Français',
  'header.openNavigation': 'فتح قائمة التنقل', 'header.lightMode': 'الوضع الفاتح', 'header.darkMode': 'الوضع الداكن', 'header.logout': 'تسجيل الخروج',
};

function buildDictionary(localeIndex: 0 | 1 | 2, translatedNavigation: Dictionary): Dictionary {
  return Object.fromEntries([
    ...Object.entries(common).map(([key, values]) => [key, values[localeIndex]]),
    ...Object.entries(translatedNavigation),
  ]);
}

const dictionaries: Record<Locale, Dictionary> = {
  ar: buildDictionary(0, navigation),
  en: buildDictionary(1, {
    'nav.dashboard': 'Dashboard', 'nav.quickPick': 'Quick pick', 'nav.channels': 'Live channels', 'nav.movies': 'Movies (VOD)',
    'nav.series': 'Series', 'nav.users': 'Users', 'nav.devices': 'Devices', 'nav.plans': 'Plans', 'nav.codes': 'Activation codes',
    'nav.import': 'IPTV import', 'nav.m3uSources': 'Automatic M3U sources', 'nav.xtreamSources': 'Xtream sources', 'nav.sources': 'Other sources',
    'nav.epg': 'Programme guide (EPG)', 'nav.versions': 'App releases', 'nav.stats': 'Statistics', 'nav.activity': 'Activity log',
    'nav.scheduler': 'Task scheduler', 'nav.settings': 'Settings', 'nav.myChannels': 'My channels', 'nav.pairDevice': 'Pair device',
    'nav.subscription': 'Subscription', 'nav.profile': 'Profile', 'language.label': 'Language', 'language.ar': 'العربية',
    'language.en': 'English', 'language.fr': 'Français', 'header.openNavigation': 'Open navigation', 'header.lightMode': 'Switch to light mode',
    'header.darkMode': 'Switch to dark mode', 'header.logout': 'Log out',
  }),
  fr: buildDictionary(2, {
    'nav.dashboard': 'Tableau de bord', 'nav.quickPick': 'Sélection rapide', 'nav.channels': 'Chaînes en direct', 'nav.movies': 'Films (VOD)',
    'nav.series': 'Séries', 'nav.users': 'Utilisateurs', 'nav.devices': 'Appareils', 'nav.plans': 'Forfaits', 'nav.codes': "Codes d’activation",
    'nav.import': 'Import IPTV', 'nav.m3uSources': 'Sources M3U automatiques', 'nav.xtreamSources': 'Sources Xtream', 'nav.sources': 'Autres sources',
    'nav.epg': 'Guide des programmes (EPG)', 'nav.versions': 'Versions de l’application', 'nav.stats': 'Statistiques', 'nav.activity': 'Journal d’activité',
    'nav.scheduler': 'Planificateur de tâches', 'nav.settings': 'Paramètres', 'nav.myChannels': 'Mes chaînes', 'nav.pairDevice': 'Associer un appareil',
    'nav.subscription': 'Abonnement', 'nav.profile': 'Profil', 'language.label': 'Langue', 'language.ar': 'العربية',
    'language.en': 'English', 'language.fr': 'Français', 'header.openNavigation': 'Ouvrir la navigation', 'header.lightMode': 'Passer au thème clair',
    'header.darkMode': 'Passer au thème sombre', 'header.logout': 'Se déconnecter',
  }),
};

interface LocaleContextValue { locale: Locale; setLocale: (locale: Locale) => void; t: (key: string) => string; }
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
