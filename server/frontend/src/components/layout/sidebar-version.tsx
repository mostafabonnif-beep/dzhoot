'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

/** Displays the live server version in the sidebar footer (fetched once). */
export default function SidebarVersion() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/config/info')
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data || res.data;
        if (data?.version) setVersion(String(data.version));
      })
      .catch(() => {
        /* keep the brand-only footer on failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;
  return <span className="text-xs text-muted-foreground px-2">DZ HOOF IPTV · {version}</span>;
}
