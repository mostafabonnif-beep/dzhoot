'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { useLocale } from '@/components/locale-provider';

/**
 * Dashboard alert: outstanding reseller credit debts (ديون المحلات).
 * Shows only when something is owed; links to the resellers page.
 */
export function ResellerDebtsAlert() {
  const { locale } = useLocale();
  const [summary, setSummary] = useState<{ outstanding: number; unpaidCount: number } | null>(null);

  useEffect(() => {
    api
      .get('/admin/reseller-debts')
      .then((res) => setSummary(res.data?.summary || null))
      .catch(() => {
        /* secondary widget — ignore */
      });
  }, []);

  if (!summary || summary.unpaidCount === 0) return null;

  const L = (ar: string, fr: string, en: string) => (locale === 'ar' ? ar : locale === 'fr' ? fr : en);

  return (
    <Link
      href="/admin/resellers"
      className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition-colors"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        {L('ديون غير مسددة على المحلات:', 'Dettes impayées des revendeurs:', 'Unpaid reseller debts:')}{' '}
        <b>{summary.unpaidCount}</b> — <b dir="ltr">{Number(summary.outstanding).toLocaleString()} DZD</b>
      </span>
      <span className="text-xs underline ms-auto">
        {L('التفاصيل', 'Détails', 'Details')} ←
      </span>
    </Link>
  );
}
