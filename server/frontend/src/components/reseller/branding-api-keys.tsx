'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';
import { useToast } from '@/hooks/use-toast';

interface ApiKeyMeta {
  _id: string;
  name: string;
  prefix: string;
  createdAt?: string;
  lastUsedAt?: string | null;
}

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

export default function BrandingApiKeysSection() {
  const { t } = useLocale();
  const { toast } = useToast();

  // Branding (الهوية البصرية) — what the reseller's customers see.
  const [brand, setBrand] = useState({ displayName: '', logoUrl: '', primaryColor: '' });
  const [savingBrand, setSavingBrand] = useState(false);

  // API keys (مفاتيح API) — read-only programmatic access.
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const res = await api.get('/reseller/api-keys');
      setKeys(res.data?.data || []);
    } catch {
      setKeys([]);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/reseller/me');
        const b = res.data?.data?.branding || {};
        setBrand({
          displayName: b.displayName || '',
          logoUrl: b.logoUrl || '',
          primaryColor: b.primaryColor || '',
        });
      } catch {
        /* profile load is best-effort */
      }
      await loadKeys();
    })();
  }, [loadKeys]);

  async function saveBranding() {
    setSavingBrand(true);
    try {
      await api.put('/reseller/branding', {
        displayName: brand.displayName,
        logoUrl: brand.logoUrl,
        primaryColor: brand.primaryColor,
      });
      toast(t('resellers.brandingSaved'), 'success');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('resellers.brandingError'), 'error');
    } finally {
      setSavingBrand(false);
    }
  }

  async function createKey() {
    setCreating(true);
    try {
      const res = await api.post('/reseller/api-keys', { name: newKeyName });
      setRevealedKey(res.data?.data?.key || null);
      setRevealedKeyId(res.data?.data?._id || null);
      setNewKeyName('');
      await loadKeys();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast(axiosErr.response?.data?.error || t('resellers.apiKeyError'), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    try {
      await api.delete(`/reseller/api-keys/${id}`);
      toast(t('resellers.apiKeyRevokedToast'), 'success');
      await loadKeys();
    } catch {
      toast(t('resellers.apiKeyError'), 'error');
    }
  }

  return (
    <section className="border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-4">
        <Building2 className="h-4 w-4" /> {t('resellers.branding')}
      </h2>

      {/* Branding form */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
        <input
          className={inputClass}
          value={brand.displayName}
          onChange={(e) => setBrand({ ...brand, displayName: e.target.value })}
          placeholder={t('resellers.brandingName')}
          maxLength={60}
        />
        <input
          className={inputClass}
          value={brand.logoUrl}
          onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value })}
          placeholder="https://... logo.png"
          dir="ltr"
        />
        <input
          className={inputClass}
          value={brand.primaryColor}
          onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
          placeholder="#22c55e"
          dir="ltr"
        />
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-6">
        <button
          onClick={saveBranding}
          disabled={savingBrand}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {savingBrand ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('resellers.brandingSave')}
        </button>
        <p className="text-[11px] text-muted-foreground">{t('resellers.brandingHint')}</p>
      </div>

      {/* API keys */}
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-2">
        <KeyRound className="h-4 w-4" /> {t('resellers.apiKeys')}
      </h2>
      <p className="text-[11px] text-muted-foreground mb-3">{t('resellers.apiKeyHint')}</p>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          className={inputClass}
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder={t('resellers.apiKeyNamePlaceholder')}
          maxLength={60}
        />
        <button
          onClick={createKey}
          disabled={creating || !newKeyName.trim()}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium border border-primary/40 text-primary hover:bg-primary/5 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {t('resellers.apiKeyCreate')}
        </button>
      </div>

      {revealedKey && (
        <div className="mb-3 border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('resellers.apiKeyOnce')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded font-mono break-all" dir="ltr">
              {revealedKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(revealedKey);
                toast(t('common.copied'), 'success');
              }}
              className="p-1.5 text-muted-foreground hover:text-foreground"
              title={t('common.copy')}
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => {
              setRevealedKey(null);
              setRevealedKeyId(null);
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('resellers.apiKeyHide')}
          </button>
        </div>
      )}

      {loadingKeys ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('resellers.apiKeysEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-right text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('resellers.apiKeyName')}</th>
                <th className="px-3 py-2 font-medium">{t('resellers.apiKeyPrefix')}</th>
                <th className="px-3 py-2 font-medium">{t('resellers.apiKeyCreated')}</th>
                <th className="px-3 py-2 font-medium">{t('resellers.apiKeyLastUsed')}</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k._id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{k.name}</td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {k.prefix}…
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-left">
                    <button
                      onClick={() => revokeKey(k._id)}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                      title={t('resellers.apiKeyRevoke')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
