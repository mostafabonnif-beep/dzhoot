'use client';

import { useEffect, useRef } from 'react';

/**
 * Google AdSense unit (web).
 *
 * The publisher id and slot id come from the server (`/api/v1/ads/me`), which
 * only reports them while the operator keeps ads enabled — nothing is
 * hard-coded here and a paid code never mounts a unit at all.
 *
 * The AdSense library is injected once per page and the unit is pushed exactly
 * once; re-renders never push the same slot twice (that would throw
 * "adsbygoogle.push() error: All ins elements ... already have ads").
 */

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const SCRIPT_SELECTOR = 'script[src*="adsbygoogle.js"]';

interface AdsenseSlotProps {
  clientId: string;
  slot: string;
  format?: string;
  className?: string;
  label?: string;
}

export default function AdsenseSlot({
  clientId,
  slot,
  format = 'auto',
  className,
  label = 'إعلان',
}: AdsenseSlotProps) {
  const pushed = useRef(false);

  useEffect(() => {
    if (!clientId || !slot || pushed.current) return;
    pushed.current = true;

    const push = () => {
      try {
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
      } catch {
        /* AdSense blocked or not ready — never break the page for an ad. */
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
    if (existing) {
      push();
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
      clientId,
    )}`;
    script.onload = push;
    document.head.appendChild(script);
  }, [clientId, slot]);

  if (!clientId || !slot) return null;

  return (
    <div className={className} aria-label={label} role="complementary">
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
