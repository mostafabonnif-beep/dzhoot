import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Tv,
  Film,
  Users,
  Settings,
  BarChart3,
  Smartphone,
  ChevronLeft,
  ChevronRight,
  Globe,
  UserCircle,
  Package,
  MonitorPlay,
  Server,
  Link2,
  Zap,
  Calendar,
  Activity,
  Clock,
  X,
  CreditCard,
  KeyRound,
  Bell,
  Video,
  Store,
} from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { BrandMark } from './brand-mark';
import { useLocale } from '@/components/locale-provider';

const adminLinks = [
  { href: '/admin', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/admin/quick-pick', labelKey: 'nav.quickPick', icon: Zap },
  { href: '/admin/channels', labelKey: 'nav.channels', icon: Tv },
  { href: '/admin/movies', labelKey: 'nav.movies', icon: Film },
  { href: '/admin/series', labelKey: 'nav.series', icon: MonitorPlay },
  { href: '/admin/users', labelKey: 'nav.users', icon: Users },
  { href: '/admin/devices', labelKey: 'nav.devices', icon: Smartphone },
  { href: '/admin/plans', labelKey: 'nav.plans', icon: CreditCard },
  { href: '/admin/codes', labelKey: 'nav.codes', icon: KeyRound },
  { href: '/admin/resellers', labelKey: 'nav.resellers', icon: Store },
  { href: '/admin/code-batches', labelKey: 'nav.codeBatches', icon: Package },
  { href: '/admin/import', labelKey: 'nav.import', icon: Globe },
  { href: '/admin/m3u-sources', labelKey: 'nav.m3uSources', icon: Link2 },
  { href: '/admin/xtream-sources', labelKey: 'nav.xtreamSources', icon: Server },
  { href: '/admin/sources', labelKey: 'nav.sources', icon: MonitorPlay },
  { href: '/admin/epg', labelKey: 'nav.epg', icon: Calendar },
  { href: '/admin/versions', labelKey: 'nav.versions', icon: Package },
  { href: '/admin/stats', labelKey: 'nav.stats', icon: BarChart3 },
  { href: '/admin/activity', labelKey: 'nav.activity', icon: Activity },
  { href: '/admin/scheduler', labelKey: 'nav.scheduler', icon: Clock },
  { href: '/admin/notifications', labelKey: 'nav.notifications', icon: Bell },
  { href: '/admin/recordings', labelKey: 'nav.recordings', icon: Video },
  { href: '/admin/settings', labelKey: 'nav.settings', icon: Settings },
];

const userLinks = [
  { href: '/user', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/user/quick-pick', labelKey: 'nav.quickPick', icon: Zap },
  { href: '/user/channels', labelKey: 'nav.myChannels', icon: Tv },
  { href: '/user/import', labelKey: 'nav.import', icon: Globe },
  { href: '/user/sources', labelKey: 'nav.sources', icon: MonitorPlay },
  { href: '/user/devices', labelKey: 'nav.pairDevice', icon: Smartphone },
  { href: '/user/subscription', labelKey: 'nav.subscription', icon: CreditCard },
  { href: '/user/profile', labelKey: 'nav.profile', icon: UserCircle },
];

const adminNavigationGroups = [
  { labelKey: 'nav.section.overview', links: adminLinks.slice(0, 1) },
  { labelKey: 'nav.section.content', links: adminLinks.slice(1, 5) },
  { labelKey: 'nav.section.customers', links: adminLinks.slice(5, 11) },
  { labelKey: 'nav.section.sources', links: adminLinks.slice(11, 16) },
  { labelKey: 'nav.section.operations', links: adminLinks.slice(16) },
];

export function Sidebar({ role }: { role: 'admin' | 'user' }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();

  const navigationGroups = role === 'admin'
    ? adminNavigationGroups
    : [{ labelKey: 'nav.section.overview', links: userLinks }];

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-45 bg-black/50 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-50 flex flex-col border-l border-border/70 bg-card/95 shadow-2xl shadow-slate-900/10 backdrop-blur-xl transition-all duration-300 lg:static lg:z-auto ${
          sidebarCollapsed ? 'w-20' : 'w-64'
        } ${
          mobileSidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex h-20 items-center justify-between border-b border-border/70 bg-gradient-to-l from-primary/[0.08] to-transparent px-4">
          {!sidebarCollapsed && <BrandMark href={role === 'admin' ? '/admin' : '/user'} />}
          {sidebarCollapsed && (
            <BrandMark href={role === 'admin' ? '/admin' : '/user'} compact />
          )}
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden p-1 rounded-md text-muted-foreground hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav aria-label={role === 'admin' ? 'تنقل الإدارة' : 'تنقل الحساب'} className="flex-1 overflow-y-auto px-3 py-5">
          {navigationGroups.map((group, groupIndex) => (
            <div key={group.labelKey} className={groupIndex === 0 ? '' : 'mt-5'}>
              {!sidebarCollapsed && role === 'admin' && (
                <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">
                  {t(group.labelKey)}
                </p>
              )}
              <div className="space-y-1.5">
                {group.links.map((link) => {
                  const Icon = link.icon;
                  const isActive = pathname === link.href || (link.href !== '/admin' && link.href !== '/user' && pathname.startsWith(link.href));

                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      title={sidebarCollapsed ? t(link.labelKey) : undefined}
                      className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                          : 'text-muted-foreground hover:bg-primary/[0.06] hover:text-foreground'
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                      {!sidebarCollapsed && <span className="truncate">{t(link.labelKey)}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer / Collapse Toggle */}
        <div className="border-t border-border/70 p-3 hidden lg:flex items-center justify-between">
          {!sidebarCollapsed && (
            <span className="text-xs text-muted-foreground px-2">DZ HOOF IPTV · 1.0.0</span>
          )}
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground mx-auto lg:mx-0"
            title={sidebarCollapsed ? 'توسيع القائمة' : 'تصغير القائمة'}
          >
            {sidebarCollapsed ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
        </div>
      </aside>
    </>
  );
}
