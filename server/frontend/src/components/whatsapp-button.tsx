'use client';

import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';

/**
 * WhatsApp contact button whose number is pulled from the live shop settings
 * (`GET /api/v1/shop/plans`) instead of being hard-coded. Falls back to the
 * operator's real number if the API is unreachable.
 *
 * Usage:
 *   <WhatsAppButton label="راسلنا الآن" className="..." variant="solid|outline" />
 */

const FALLBACK_NUMBER = '213561225248'; // DZ HOOF operator line (0561225248)

type Props = {
  label: string;
  message?: string;
  className?: string;
  variant?: 'solid' | 'outline';
};

export default function WhatsAppButton({ label, message, className = '', variant = 'solid' }: Props) {
  const [number, setNumber] = useState<string>(FALLBACK_NUMBER);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/shop/plans', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const raw = j?.data?.shop?.phone || j?.data?.whatsapp;
        if (!cancelled && raw) {
          const digits = String(raw).replace(/[^\d]/g, '').replace(/^0/, '213');
          if (digits.length >= 9) setNumber(digits);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const href = `https://wa.me/${number}${
    message ? `?text=${encodeURIComponent(message)}` : ''
  }`;

  const base =
    'inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition';
  const styles =
    variant === 'solid'
      ? 'bg-[#128C4A] px-6 py-2.5 text-white hover:bg-[#0e7a3e]' // dark-enough green for AA contrast
      : 'border border-primary-foreground/40 px-7 py-3 text-base hover:bg-primary-foreground/10';

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${base} ${styles} ${className}`}>
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}
