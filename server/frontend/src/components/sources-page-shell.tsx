'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Tv, Monitor, Zap, Download, Youtube, Radio } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useBulkSelection } from '@/hooks/use-bulk-selection';
import { useStreamPlayer } from '@/components/stream-player-context';
import { useLocale } from '@/components/locale-provider';
import ChannelDetailModal, { type ChannelField } from '@/components/channel-detail-modal';
import ExternalSourceTab from '@/components/external-source-tab';
import SourceChannelDataTable from '@/components/source-channel-data-table';
import LivenessStatsBar from '@/components/ui/liveness-stats-bar';
import type {
  SourceChannel,
  SourceTab,
  LivenessStats,
  ChannelLiveness,
} from '@/types/external-sources';

const TABS: { id: SourceTab; label: string; icon: typeof Tv; defaultRegion?: string }[] = [
  { id: 'pluto-tv', label: 'Pluto TV', icon: Tv },
  { id: 'samsung-tv-plus', label: 'Samsung TV Plus', icon: Monitor },
  { id: 'youtube-live', label: 'YouTube Live', icon: Youtube, defaultRegion: 'in' },
  { id: 'prasar-bharati', label: 'Prasar Bharati', icon: Radio, defaultRegion: 'in' },
];

interface SourcesPageShellProps {
  mode: 'admin' | 'user';
}

export default function SourcesPageShell({ mode }: SourcesPageShellProps) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<SourceTab>('pluto-tv');
  const { playStream } = useStreamPlayer();
  const [detailChannel, setDetailChannel] = useState<SourceChannel | null>(null);
  const selection = useBulkSelection();
  const [statsData, setStatsData] = useState<{ stats: LivenessStats; inProgress: boolean } | null>(
    null,
  );

  const handlePlay = useCallback(
    (ch: SourceChannel) => {
      playStream(
        {
          name: ch.channelName || t('sources.streamPreview'),
          url: ch.channelUrl,
          // Raw upstream logo (stream player UI does not render it; never
          // proxy here — an <img> cannot attach the session header).
          logo: ch.tvgLogo || undefined,
        },
        { mode: 'direct-fallback' },
      );
    },
    [playStream, t],
  );

  const detailFields: ChannelField[] = detailChannel
    ? [
        { label: t('sources.streamUrl'), value: detailChannel.channelUrl },
        ...(mode === 'admin' ? [{ label: t('sources.logoUrl'), value: detailChannel.tvgLogo }] : []),
        { label: t('sources.category'), value: detailChannel.groupTitle },
        { label: t('sources.country'), value: detailChannel.country },
        ...(mode === 'admin' ? [{ label: t('sources.source'), value: detailChannel.source }] : []),
        { label: t('sources.codec'), value: detailChannel.codec },
        {
          label: t('sources.bitrate'),
          value: detailChannel.bitrate ? `${detailChannel.bitrate} kbps` : undefined,
        },
        { label: t('sources.language'), value: detailChannel.language },
        ...(mode === 'admin'
          ? [
              {
                label: t('sources.votes'),
                value: detailChannel.votes != null ? String(detailChannel.votes) : undefined,
              },
              { label: t('sources.homepage'), value: detailChannel.homepage },
              {
                label: t('sources.liveness'),
                value: detailChannel.liveness
                  ? `${detailChannel.liveness.status}${detailChannel.liveness.responseTimeMs ? ` (${detailChannel.liveness.responseTimeMs}ms)` : ''}${detailChannel.liveness.error ? ` — ${detailChannel.liveness.error}` : ''}`
                  : undefined,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-display font-bold uppercase tracking-[0.1em]">{t('sources.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === 'admin'
            ? t('sources.adminDescription')
            : t('sources.userDescription')}
        </p>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActiveTab(tab.id);
                selection.unselectAll();
                setStatsData(null);
              }}
              className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 text-xs sm:text-sm font-medium uppercase tracking-[0.1em] transition-colors border-b-2 -mb-px whitespace-nowrap ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="space-y-4">
        <ExternalSourceTab
          key={activeTab}
          sourceKey={activeTab}
          sourceLabel={TABS.find((t) => t.id === activeTab)!.label}
          defaultRegion={TABS.find((t) => t.id === activeTab)?.defaultRegion}
          topSlot={
            statsData ? (
              <LivenessStatsBar stats={statsData.stats} inProgress={statsData.inProgress} />
            ) : null
          }
        >
          {({ channels, region, onChannelUpdate }) => (
            <SourceContent
              channels={channels}
              source={activeTab}
              region={region}
              selection={selection}
              onPlay={handlePlay}
              onDetail={setDetailChannel}
              onChannelUpdate={onChannelUpdate}
              mode={mode}
              onStatsChange={setStatsData}
            />
          )}
        </ExternalSourceTab>
      </div>

      <ChannelDetailModal
        open={!!detailChannel}
        onClose={() => setDetailChannel(null)}
        channel={detailChannel}
        fields={detailFields}
        onPlay={
          detailChannel?.channelUrl
            ? () => {
                const ch = detailChannel!;
                setDetailChannel(null);
                handlePlay(ch);
              }
            : undefined
        }
      />
    </div>
  );
}

function SourceContent({
  channels,
  source,
  region,
  selection,
  onPlay,
  onDetail,
  onChannelUpdate,
  mode,
  onStatsChange,
}: {
  channels: SourceChannel[];
  source: SourceTab;
  region: string;
  selection: ReturnType<typeof useBulkSelection>;
  onPlay: (ch: SourceChannel) => void;
  onDetail: (ch: SourceChannel) => void;
  onChannelUpdate: (uid: string, liveness: ChannelLiveness) => void;
  mode: 'admin' | 'user';
  onStatsChange: (data: { stats: LivenessStats; inProgress: boolean } | null) => void;
}) {
  const { toast } = useToast();
  const { locale } = useLocale();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [batchTesting, setBatchTesting] = useState(false);
  const [livenessStats, setLivenessStats] = useState<LivenessStats | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = mode === 'admin';

  const channelStats = useMemo(() => {
    if (channels.length === 0) return null;
    const alive = channels.filter((c) => c.liveness?.status === 'alive').length;
    const dead = channels.filter((c) => c.liveness?.status === 'dead').length;
    const unknown = channels.length - alive - dead;
    return { alive, dead, unknown };
  }, [channels]);

  const displayStats = isAdmin ? livenessStats : channelStats;
  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);
  const readinessLabel = !displayStats
    ? L('في انتظار بيانات المصدر', 'En attente des données', 'Waiting for source data')
    : displayStats.dead > 0
      ? L('يحتاج تنظيفًا قبل الاستيراد', 'Nettoyage requis avant import', 'Needs cleanup before import')
      : displayStats.unknown > 0
        ? L('جاهز جزئيًا ويحتاج تحققًا', 'Partiellement prêt, vérification requise', 'Partially ready, verification required')
        : L('جاهز للاستيراد', 'Prêt pour l’import', 'Ready for import');
  const readinessTone = !displayStats
    ? 'border-border bg-muted/30 text-muted-foreground'
    : displayStats.dead > 0
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : displayStats.unknown > 0
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
        : 'border-signal-green/30 bg-signal-green/5 text-signal-green';
  const readinessMessage = !displayStats
    ? L('اختر منطقة لعرض الحالة التشغيلية قبل الاستيراد أو الفحص.', 'Choisissez une région pour voir l’état opérationnel avant l’import ou le test.', 'Pick a region to see the operational state before importing or testing.')
    : displayStats.dead > 0
      ? L('يوجد عدد من القنوات الميتة؛ افحصها أو استبعدها قبل الاستيراد الجماعي.', 'Certaines chaînes sont mortes ; testez-les ou excluez-les avant un import groupé.', 'Some channels are dead; test or exclude them before bulk import.')
      : displayStats.unknown > 0
        ? L('بعض القنوات لم تُختبر بعد؛ نفّذ فحص liveness لرفع الثقة قبل الاستيراد.', 'Certaines chaînes ne sont pas encore testées ; lancez un contrôle de disponibilité avant l’import.', 'Some channels are still untested; run a liveness check before importing.')
        : L('القنوات المعروضة سليمة حاليًا ويمكن استيرادها بثقة أعلى.', 'Les chaînes affichées sont saines et peuvent être importées avec plus de confiance.', 'Displayed channels look healthy and can be imported with higher confidence.');

  useEffect(() => {
    if (displayStats) {
      onStatsChange({ stats: displayStats, inProgress: batchTesting });
    } else {
      onStatsChange(null);
    }
  }, [displayStats, batchTesting, onStatsChange]);

  const fetchLivenessStats = useCallback(async () => {
    if (!isAdmin || !source || !region) return;
    try {
      const res = await api.get(
        `/external-sources/liveness-status?source=${source}&region=${encodeURIComponent(region)}`,
      );
      const data = res.data.data;
      setLivenessStats(data.livenessStats);
      if (!data.livenessCheckInProgress && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setBatchTesting(false);
      }
      if (data.livenessCheckInProgress) {
        setBatchTesting(true);
      }
    } catch {
      // ignore
    }
  }, [isAdmin, source, region]);

  useEffect(() => {
    fetchLivenessStats();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLivenessStats]);

  async function handleBatchLivenessCheck() {
    if (batchTesting || !source || !region) return;
    setBatchTesting(true);
    try {
      await api.post('/external-sources/check-liveness', { source, region });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchLivenessStats, 5000);
    } catch {
      setBatchTesting(false);
    }
  }

  async function handleTestChannel(ch: SourceChannel) {
    try {
      const res = await api.post(`/external-sources/check-liveness/${ch._uid}`);
      const result = res.data.data;
      if (result) {
        if (isAdmin) {
          onChannelUpdate(ch._uid, {
            status: result.status,
            lastCheckedAt: new Date().toISOString(),
            responseTimeMs: result.responseTimeMs,
            error: result.error,
          });
          fetchLivenessStats();
        } else {
          toast(
            result.status === 'alive' ? 'Stream is alive' : `Stream is ${result.status}`,
            result.status === 'alive' ? 'success' : 'error',
          );
        }
      }
    } catch {
      toast('Failed to test stream', 'error');
    }
  }

  async function handleImport() {
    if (selection.count === 0) return;
    setImporting(true);
    setImportResult(null);

    const toImport = channels
      .filter((c) => selection.isSelected(c._uid))
      .map((c) => ({
        channelName: c.channelName,
        channelUrl: c.channelUrl,
        tvgLogo: c.tvgLogo || '',
        groupTitle: c.groupTitle || 'Imported',
        channelId: c.channelId || '',
        country: c.country || '',
        language: c.language || '',
      }));

    try {
      const endpoint = isAdmin ? '/external-sources/import' : '/external-sources/import-user';
      const payload = isAdmin ? { channels: toImport, replaceExisting } : { channels: toImport };
      const res = await api.post(endpoint, payload);
      const body = res.data;
      setImportResult(
        body.message ||
          (isAdmin
            ? `Imported ${body.importedCount || toImport.length} channels to system`
            : `Added ${body.addedCount || toImport.length} channels to your list`),
      );
    } catch {
      setImportResult('Failed to import channels');
    } finally {
      setImporting(false);
    }
  }

  return (
    <SourceChannelDataTable
      channels={channels}
      selection={selection}
      onPlay={onPlay}
      onDetail={onDetail}
      showLiveness
      onTestChannel={handleTestChannel}
      headerSlot={
        <section className={`rounded-lg border px-4 py-3 ${readinessTone}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em]">{L('ملخص تشغيلي للمصدر', 'Résumé opérationnel de la source', 'Source operational summary')}</p>
              <p className="mt-2 text-lg font-bold">{readinessLabel}</p>
              <p className="mt-1 text-sm opacity-90">{readinessMessage}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div>
                <div className="text-xs opacity-70">{L('إجمالي القنوات', 'Total chaînes', 'Total channels')}</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{channels.length}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{L('سليمة', 'Saines', 'Alive')}</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{displayStats?.alive ?? 0}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{L('ميتة', 'Mortes', 'Dead')}</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{displayStats?.dead ?? 0}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{L('محددة للاستيراد', 'Sélectionnées', 'Selected for import')}</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{selection.count}</div>
              </div>
            </div>
          </div>
        </section>
      }
      toolbarActions={
        <>
          {isAdmin && (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="accent-primary"
                />
                Replace existing
              </label>
              <button
                onClick={handleBatchLivenessCheck}
                disabled={batchTesting}
                className="inline-flex items-center gap-2 px-4 py-2.5 h-10 text-sm font-medium border border-border bg-card text-foreground uppercase tracking-[0.1em] transition-colors hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
              >
                {batchTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {batchTesting ? 'Checking...' : 'Check Liveness'}
              </button>
            </>
          )}
          <button
            onClick={handleImport}
            disabled={importing || selection.count === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground uppercase tracking-[0.1em] transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
          >
            <Download className="h-4 w-4" />
            {importing
              ? 'Importing...'
              : `Import ${selection.count} to ${isAdmin ? 'System' : 'My List'}`}
          </button>
        </>
      }
      bannerSlot={
        importResult ? (
          <div className="border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
            {importResult}
          </div>
        ) : null
      }
    />
  );
}
