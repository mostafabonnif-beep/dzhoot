'use client';

import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useLocale } from '@/components/locale-provider';

/**
 * Freemium monetization settings (admin).
 *
 *   free_access — what the shared free code may watch, and whether it carries ads.
 *   ads         — AdSense (web) / AdMob (Android) identifiers. Ad requests only
 *                 happen while `enabled` is on; a paying code never sees an ad.
 *
 * The ids are validated server-side (admin-app-settings → ads-policy), so an
 * invalid publisher/slot id is rejected instead of silently stored.
 */

interface AdsConfig {
  enabled: boolean;
  showOnFreeTier: boolean;
  interstitialEveryMinutes: number;
  frequencyCapPerSession: number;
  web: { clientId: string; slotBelowPlayer: string; slotSidebar: string };
  android: {
    appId: string;
    bannerUnitId: string;
    interstitialUnitId: string;
    rewardedUnitId: string;
  };
}

interface FreeAccessConfig {
  enabled: boolean;
  channelGroups: string[];
  showAds: boolean;
}

const EMPTY_ADS: AdsConfig = {
  enabled: false,
  showOnFreeTier: true,
  interstitialEveryMinutes: 15,
  frequencyCapPerSession: 3,
  web: { clientId: '', slotBelowPlayer: '', slotSidebar: '' },
  android: { appId: '', bannerUnitId: '', interstitialUnitId: '', rewardedUnitId: '' },
};

const EMPTY_FREE: FreeAccessConfig = { enabled: false, channelGroups: [], showAds: true };

const inputClass =
  'flex h-9 w-full border border-border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

function normalizeAds(raw: unknown): AdsConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdsConfig>;
  return {
    ...EMPTY_ADS,
    ...value,
    web: { ...EMPTY_ADS.web, ...(value.web || {}) },
    android: { ...EMPTY_ADS.android, ...(value.android || {}) },
  };
}

function normalizeFree(raw: unknown): FreeAccessConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<FreeAccessConfig>;
  return {
    enabled: value.enabled === true,
    showAds: value.showAds !== false,
    channelGroups: Array.isArray(value.channelGroups) ? value.channelGroups : [],
  };
}

export default function FreemiumSettings() {
  const { toast } = useToast();
  const { locale } = useLocale();
  const ar = locale === 'ar';
  const [ads, setAds] = useState<AdsConfig>(EMPTY_ADS);
  const [free, setFree] = useState<FreeAccessConfig>(EMPTY_FREE);
  const [catalogGroups, setCatalogGroups] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get('/admin/app-settings')
      .then((res) => {
        const data = res.data?.data || {};
        setAds(normalizeAds(data.ads));
        setFree(normalizeFree(data.free_access));
      })
      .catch(() => undefined);
    api
      .get('/admin/plans/catalog-groups')
      .then((res) => setCatalogGroups(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setCatalogGroups([]));
  }, []);

  const visibleGroups = useMemo(() => {
    const merged = new Set([...catalogGroups, ...free.channelGroups]);
    const list = [...merged].sort((a, b) => a.localeCompare(b));
    const q = groupFilter.trim().toLowerCase();
    return q ? list.filter((g) => g.toLowerCase().includes(q)) : list;
  }, [catalogGroups, free.channelGroups, groupFilter]);

  async function save() {
    setSaving(true);
    try {
      await api.put('/admin/app-settings', { ads, free_access: free });
      toast(ar ? 'تم حفظ إعدادات الربح' : 'Monetization settings saved', 'success');
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast(message || (ar ? 'فشل الحفظ — تحقق من صحة المعرّفات' : 'Save failed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border">
      <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">
          {ar ? 'الربح: الطبقة المجانية والإعلانات' : 'Monetization: free tier & ads'}
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {ar ? 'المنشور: أكواد مدفوعة بلا إعلانات' : 'Paid codes never see ads'}
        </span>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* Free tier */}
        <section className="space-y-3">
          <h3 className="text-sm font-bold">{ar ? 'الطبقة المجانية (الكود العام)' : 'Free tier (shared code)'}</h3>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={free.enabled}
                onChange={(e) => setFree({ ...free, enabled: e.target.checked })}
              />
              <span>{ar ? 'إدارة الطبقة المجانية من اللوحة' : 'Manage the free tier from the panel'}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={free.showAds}
                onChange={(e) => setFree({ ...free, showAds: e.target.checked })}
              />
              <span>{ar ? 'عرض الإعلانات للمجانيين' : 'Show ads to free users'}</span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {ar
              ? 'عند التفعيل: المجموعات المحددة أدناه هي المرجع (بلا تحديد = المجاني يرى كل الكتالوج). عند الإطفاء: يبقى السلوك القديم (مجموعات DEMO_CHANNEL_GROUPS). الكود المجاني نفسه هو كود الديمو.'
              : 'When on, the groups below are authoritative (none selected = whole catalog). When off, the legacy DEMO_CHANNEL_GROUPS applies.'}
          </p>
          <input
            className={inputClass}
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            placeholder={ar ? 'ابحث في مجموعات القنوات...' : 'Search channel groups...'}
          />
          <div className="max-h-40 overflow-y-auto border border-border bg-background p-2">
            {visibleGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {ar ? 'لا توجد مجموعات في الكتالوج بعد.' : 'No catalog groups yet.'}
              </p>
            ) : (
              visibleGroups.map((group) => (
                <label key={group} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={free.channelGroups.includes(group)}
                    onChange={(e) =>
                      setFree({
                        ...free,
                        channelGroups: e.target.checked
                          ? [...free.channelGroups, group]
                          : free.channelGroups.filter((g) => g !== group),
                      })
                    }
                  />
                  <span className="truncate">{group}</span>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {free.channelGroups.length === 0
              ? ar
                ? 'المحدد حالياً: كل المجموعات'
                : 'Currently: all groups'
              : ar
                ? `${free.channelGroups.length} مجموعة محددة`
                : `${free.channelGroups.length} groups selected`}
          </p>
        </section>

        {/* Ads */}
        <section className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-5">
            <h3 className="text-sm font-bold">{ar ? 'الإعلانات' : 'Ads'}</h3>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={ads.enabled}
                onChange={(e) => setAds({ ...ads, enabled: e.target.checked })}
              />
              <span>{ar ? 'تفعيل الإعلانات' : 'Enable ads'}</span>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">AdSense clientId (ca-pub-…)</label>
              <input
                className={inputClass}
                dir="ltr"
                value={ads.web.clientId}
                onChange={(e) => setAds({ ...ads, web: { ...ads.web, clientId: e.target.value.trim() } })}
                placeholder="ca-pub-0000000000000000"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {ar ? 'AdSense slot تحت المشغل' : 'AdSense slot (below player)'}
              </label>
              <input
                className={inputClass}
                dir="ltr"
                value={ads.web.slotBelowPlayer}
                onChange={(e) =>
                  setAds({ ...ads, web: { ...ads.web, slotBelowPlayer: e.target.value.trim() } })
                }
                placeholder="1234567890"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">AdMob appId (ca-app-pub-…~…)</label>
              <input
                className={inputClass}
                dir="ltr"
                value={ads.android.appId}
                onChange={(e) => setAds({ ...ads, android: { ...ads.android, appId: e.target.value.trim() } })}
                placeholder="ca-app-pub-0000000000000000~0000000000"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">AdMob banner unit</label>
              <input
                className={inputClass}
                dir="ltr"
                value={ads.android.bannerUnitId}
                onChange={(e) =>
                  setAds({ ...ads, android: { ...ads.android, bannerUnitId: e.target.value.trim() } })
                }
                placeholder="ca-app-pub-0000000000000000/0000000000"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">AdMob interstitial unit</label>
              <input
                className={inputClass}
                dir="ltr"
                value={ads.android.interstitialUnitId}
                onChange={(e) =>
                  setAds({ ...ads, android: { ...ads.android, interstitialUnitId: e.target.value.trim() } })
                }
                placeholder="ca-app-pub-0000000000000000/0000000000"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {ar ? 'كل كم دقيقة إعلان بيني (0 = تعطيل)' : 'Interstitial every N minutes (0 = off)'}
              </label>
              <input
                type="number"
                min={0}
                max={240}
                className={inputClass}
                value={ads.interstitialEveryMinutes}
                onChange={(e) =>
                  setAds({ ...ads, interstitialEveryMinutes: Number(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {ar
              ? 'لن يُطلب أي إعلان قبل التفعيل. المعرّفات علنية بطبيعتها (تُشحن داخل التطبيقات) ولا أسرار هنا.'
              : 'No ad is requested until enabled. Identifiers are public by design.'}
          </p>
        </section>

        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center px-5 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? '...' : ar ? 'حفظ إعدادات الربح' : 'Save monetization settings'}
        </button>
      </div>
    </div>
  );
}
