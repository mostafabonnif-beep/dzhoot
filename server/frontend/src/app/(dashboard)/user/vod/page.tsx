'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import UserVodBrowser, { VodKind } from '@/components/user-vod-browser';

/**
 * User-facing VOD library (movies + series). Fill of the product gap where
 * /user/vod returned 404 while the catalog (235K movies / 58K series) was
 * only reachable from Android and the admin pages.
 * Accepts ?kind=series (used by the Discover page "Latest series" links).
 */
function VodPageInner() {
  const params = useSearchParams();
  const initialKind: VodKind = params.get('kind') === 'series' ? 'series' : 'movies';
  return <UserVodBrowser initialKind={initialKind} />;
}

export default function UserVodPage() {
  return (
    <Suspense fallback={null}>
      <VodPageInner />
    </Suspense>
  );
}
