'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Store, Package, KeyRound, Download, Copy, Check, LogOut } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useToast } from '@/hooks/use-toast';
import Modal from '@/components/ui/modal';

interface BatchItem {
  _id: string;
  batchNumber: number;
  plan: { name: string; durationDays: number } | null;
  receiptDate: string;
  notes?: string;
  stats: { total: number; activated: number; remaining: number; revoked: number };
}

interface CodeItem {
  _id: string;
  code: string;
  status: 'UNUSED' | 'ACTIVATED' | 'REVOKED' | 'EXPIRED';
  activatedAt?: string | null;
}

const inputClass =
  'flex h-10 w-full border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary';

function statusBadge(status: CodeItem['status']) {
  const map: Record<CodeItem['status'], string> = {
    UNUSED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    ACTIVATED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    REVOKED: 'bg-destructive/15 text-destructive',
    EXPIRED: 'bg-muted text-muted-foreground',
  };
  const label: Record<CodeItem['status'], string> = {
    UNUSED: 'غير مستخدم',
    ACTIVATED: 'مُفعّل',
    REVOKED: 'ملغي',
    EXPIRED: 'منتهي',
  };
  return <span className={`inline-flex px-2 py-0.5 text-xs font-medium ${map[status]}`}>{label[status]}</span>;
}

export default function ResellerDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const logout = useAuthStore((s) => s.logout);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [me, setMe] = useState<{ name: string; city: string; stats: { total: number; activated: number; remaining: number } } | null>(null);
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openBatch, setOpenBatch] = useState<BatchItem | null>(null);
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meRes, batchRes] = await Promise.all([
        api.get('/reseller/me'),
        api.get('/reseller/batches'),
      ]);
      setMe(meRes.data?.data || null);
      setBatches(batchRes.data?.data || []);
      setError('');
    } catch {
      setError('تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      router.replace('/reseller/login');
      return;
    }
    load();
  }, [accessToken, router, load]);

  async function openCodes(batch: BatchItem) {
    setOpenBatch(batch);
    setCodes([]);
    setCodesLoading(true);
    try {
      const res = await api.get(`/reseller/batches/${batch._id}/codes`);
      setCodes(res.data?.data || []);
    } catch {
      setError('تعذر تحميل الأكواد');
    } finally {
      setCodesLoading(false);
    }
  }

  function copyAll() {
    navigator.clipboard.writeText(codes.map((c) => c.code).join('\n')).then(() => {
      setCopied(true);
      toast('تم نسخ جميع الأكواد', 'success');
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function downloadBatch(batch: BatchItem) {
    try {
      const res = await api.get(`/reseller/batches/${batch._id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dzhoof-batch-${batch.batchNumber}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('تعذر تنزيل الملف', 'error');
    }
  }

  function handleLogout() {
    logout();
    router.replace('/reseller/login');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <span className="font-semibold">بوابة الموزعين — DZ HOOF</span>
          </div>
          <div className="flex items-center gap-3">
            {me && (
              <span className="text-sm text-muted-foreground">
                {me.name} {me.city ? `— ${me.city}` : ''}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" /> خروج
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {error && <div className="text-sm text-destructive">{error}</div>}

        {me && (
          <div className="grid grid-cols-3 gap-3">
            <div className="border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">إجمالي الأكواد</div>
              <div className="text-2xl font-semibold mt-1">{me.stats.total}</div>
            </div>
            <div className="border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">مُفعّلة</div>
              <div className="text-2xl font-semibold mt-1 text-emerald-600 dark:text-emerald-400">{me.stats.activated}</div>
            </div>
            <div className="border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">المتبقي</div>
              <div className="text-2xl font-semibold mt-1 text-sky-600 dark:text-sky-400">{me.stats.remaining}</div>
            </div>
          </div>
        )}

        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            <Package className="h-4 w-4" /> دفعاتي
          </h2>
          {batches.length === 0 ? (
            <div className="border border-dashed border-border p-8 text-center text-muted-foreground">
              لا توجد دفعات بعد — تواصل مع الإدارة لاستلام أول دفعة.
            </div>
          ) : (
            <div className="border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    <th className="text-right p-3">الدفعة</th>
                    <th className="text-right p-3">المدة</th>
                    <th className="text-right p-3">تاريخ الاستلام</th>
                    <th className="text-right p-3">مُفعّل / إجمالي</th>
                    <th className="text-right p-3">المتبقي</th>
                    <th className="text-right p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b._id} className="border-b border-border/50 last:border-0">
                      <td className="p-3 font-medium">دفعة {b.batchNumber}</td>
                      <td className="p-3">
                        {b.plan ? `${b.plan.name} — ${b.plan.durationDays} يوم` : '—'}
                      </td>
                      <td className="p-3" dir="ltr">{b.receiptDate?.slice(0, 10)}</td>
                      <td className="p-3">
                        <span className="text-emerald-600 dark:text-emerald-400">{b.stats.activated}</span>
                        {' / '}
                        {b.stats.total}
                      </td>
                      <td className="p-3 text-sky-600 dark:text-sky-400">{b.stats.remaining}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openCodes(b)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
                          >
                            <KeyRound className="h-3.5 w-3.5" /> الأكواد
                          </button>
                          <button
                            onClick={() => downloadBatch(b)}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
                          >
                            <Download className="h-3.5 w-3.5" /> ملف
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <Modal open={!!openBatch} onClose={() => setOpenBatch(null)} title={openBatch ? `دفعة ${openBatch.batchNumber} — الأكواد` : ''}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {codes.filter((c) => c.status === 'ACTIVATED').length} مفعّل من {codes.length}
            </span>
            <button
              onClick={copyAll}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-border hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              نسخ الكل
            </button>
          </div>
          {codesLoading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {codes.map((c) => (
                <div key={c._id} className="flex items-center justify-between border border-border px-3 py-2">
                  <code className="text-sm font-mono" dir="ltr">{c.code}</code>
                  {statusBadge(c.status)}
                </div>
              ))}
              {codes.length === 0 && !codesLoading && (
                <div className="text-center text-muted-foreground py-6">لا توجد أكواد في هذه الدفعة.</div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
