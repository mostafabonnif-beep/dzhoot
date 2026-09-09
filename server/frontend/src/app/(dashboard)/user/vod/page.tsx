'use client';

import UserVodBrowser from '@/components/user-vod-browser';

/**
 * User-facing VOD library (movies + series). Fill of the product gap where
 * /user/vod returned 404 while the catalog (235K movies / 58K series) was
 * only reachable from Android and the admin pages.
 */
export default function UserVodPage() {
  return <UserVodBrowser />;
}
