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
  Link2,
  Zap,
  Calendar,
  Activity,
  Clock,
  X,
  CreditCard,
  KeyRound,
} from 'lucide-react';
import { useUIStore } from '@/store/ui-store';

const adminLinks = [
  { href: '/admin', label: 'لوحة التحكم', icon: LayoutDashboard },
  { href: '/admin/quick-pick', label: 'اختيار سريع', icon: Zap },
  { href: '/admin/channels', label: 'القنوات المباشرة', icon: Tv },
  { href: '/admin/movies', label: 'الأفلام (VOD)', icon: Film },
  { href: '/admin/series', label: 'المسلسلات', icon: MonitorPlay },
  { href: '/admin/users', label: 'المستخدمون', icon: Users },
  { href: '/admin/devices', label: 'الأجهزة', icon: Smartphone },
  { href: '/admin/plans', label: 'الباقات', icon: CreditCard },
  { href: '/admin/codes', label: 'أكواد التفعيل', icon: KeyRound },
  { href: '/admin/import', label: 'استيراد IPTV', icon: Globe },
  { href: '/admin/m3u-sources', label: 'مصادر M3U التلقائية', icon: Link2 },
  { href: '/admin/sources', label: 'مصادر أخرى', icon: MonitorPlay },
  { href: '/admin/epg', label: 'دليل البرامج (EPG)', icon: Calendar },
  { href: '/admin/versions', label: 'إصدارات التطبيق', icon: Package },
  { href: '/admin/stats', label: 'الإحصائيات', icon: BarChart3 },
  { href: '/admin/activity', label: 'سجل النشاط', icon: Activity },
  { href: '/admin/scheduler', label: 'جدول المهام', icon: Clock },
  { href: '/admin/settings', label: 'الإعدادات', icon: Settings },
];

const userLinks = [
  { href: '/user', label: 'لوحة التحكم', icon: LayoutDashboard },
  { href: '/user/quick-pick', label: 'اختيار سريع', icon: Zap },
  { href: '/user/channels', label: 'قنواتـي', icon: Tv },
  { href: '/user/import', label: 'استيراد IPTV', icon: Globe },
  { href: '/user/sources', label: 'مصادر أخرى', icon: MonitorPlay },
  { href: '/user/devices', label: 'ربط الجهاز', icon: Smartphone },
  { href: '/user/subscription', label: 'الاشتراك', icon: CreditCard },
  { href: '/user/profile', label: 'الملف الشخصي', icon: UserCircle },
];

export function Sidebar({ role }: { role: 'admin' | 'user' }) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();

  const links = role === 'admin' ? adminLinks : userLinks;

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
        <div className="flex h-20 items-center justify-between border-b border-border/70 px-4">
          {!sidebarCollapsed && (
            <Link href={role === 'admin' ? '/admin' : '/user'} className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25">
                DZ
              </div>
              <span className="font-display font-bold tracking-tight">DZ HOOF<span className="text-primary"> IPTV</span></span>
            </Link>
          )}
          {sidebarCollapsed && (
            <Link href={role === 'admin' ? '/admin' : '/user'} className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25">
              DZ
            </Link>
          )}
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden p-1 rounded-md text-muted-foreground hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto px-3 py-5 space-y-1.5">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href || (link.href !== '/admin' && link.href !== '/user' && pathname.startsWith(link.href));

            return (
              <Link
                key={link.href}
                href={link.href}
                title={sidebarCollapsed ? link.label : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                    : 'text-muted-foreground hover:bg-primary/[0.06] hover:text-foreground'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                {!sidebarCollapsed && <span className="truncate">{link.label}</span>}
              </Link>
            );
          })}
        </div>

        {/* Sidebar Footer / Collapse Toggle */}
        <div className="border-t border-border/70 p-3 hidden lg:flex items-center justify-between">
          {!sidebarCollapsed && (
            <span className="text-xs text-muted-foreground px-2">نسخة التطوير 1.0.0</span>
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
