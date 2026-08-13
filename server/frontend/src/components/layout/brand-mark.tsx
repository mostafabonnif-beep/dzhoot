'use client';

import Link from 'next/link';
import { Radio } from 'lucide-react';

interface BrandMarkProps {
  href?: string;
  compact?: boolean;
  dark?: boolean;
  className?: string;
}

export function BrandMark({ href = '/', compact = false, dark = false, className = '' }: BrandMarkProps) {
  const content = (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <span
        className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-orange-500 text-primary-foreground shadow-lg shadow-primary/25"
        aria-hidden="true"
      >
        <span className="absolute -right-3 -top-3 h-8 w-8 rounded-full border border-white/30" />
        <Radio className="relative h-5 w-5" strokeWidth={2.4} />
      </span>
      {!compact && (
        <span className={`font-display text-lg font-extrabold tracking-tight ${dark ? 'text-white' : 'text-foreground'}`}>
          DZ HOOF<span className="text-primary"> IPTV</span>
        </span>
      )}
    </span>
  );

  return href ? <Link href={href} aria-label="DZ HOOF IPTV">{content}</Link> : content;
}
