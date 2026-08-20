'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Languages, LogOut, Menu, Moon, Sun, UserCircle } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/store/auth-store';
import { useUIStore } from '@/store/ui-store';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';

export function Header() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuthStore();
  const { toggleMobileSidebar } = useUIStore();
  const { locale, setLocale, t } = useLocale();

  const [picError, setPicError] = useState(false);

  const rawPic = user?.profilePicture;
  const profilePic =
    rawPic && !picError
      ? rawPic.startsWith('/') && !rawPic.startsWith('//')
        ? `/api/v1${rawPic}`
        : rawPic.startsWith('http')
          ? rawPic
          : null
      : null;

  async function handleLogout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Logout even if API call fails
    }
    logout();
    router.push('/login');
  }

  return (
    <header className="flex h-11 items-center justify-between border-b border-border bg-background px-4">
      <button
        onClick={toggleMobileSidebar}
        className="flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary md:hidden"
                  aria-label={t('header.openNavigation')}

      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="relative inline-flex items-center gap-1.5 ml-auto">
                  <label className="inline-flex h-10 items-center gap-1.5 border-l border-border px-2 text-xs text-muted-foreground">
            <Languages className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('language.label')}</span>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as 'ar' | 'en' | 'fr')}
              className="bg-transparent text-xs text-foreground outline-none"
              aria-label={t('language.label')}
            >
              <option value="ar">{t('language.ar')}</option>
              <option value="en">{t('language.en')}</option>
              <option value="fr">{t('language.fr')}</option>
            </select>
          </label>

          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}

          className="relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
          aria-pressed={theme === 'dark'}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
        </button>

        {user && (
          <div className="flex items-center gap-2 px-2 border-l border-border ml-1">
            {profilePic ? (
              /* eslint-disable-next-line @next/next/no-img-element -- dynamic external URL with onError fallback */
              <img
                src={profilePic}
                alt={`صورة الملف الشخصي للمستخدم ${user.username}`}
                loading="lazy"
                width={24}
                height={24}
                className="h-6 w-6 rounded-full object-cover"
                onError={() => setPicError(true)}
              />
            ) : (
              <UserCircle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">{user.username}</span>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t('header.logout')}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
