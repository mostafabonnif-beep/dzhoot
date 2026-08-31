'use client';

import Link from 'next/link';
import Image from 'next/image';

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
        className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-lg shadow-primary/20 ring-1 ring-white/10"
        aria-hidden="true"
      >
        <Image
          src="/logo.png"
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 object-cover"
          priority
        />
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
