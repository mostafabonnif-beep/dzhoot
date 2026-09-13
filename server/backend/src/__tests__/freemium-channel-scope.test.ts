import AppSetting from '../models/AppSetting';
import {
  normalizeGroupList,
  allowedGroupsForUser,
  isChannelAllowedForUser,
  applyGroupScope,
  groupScopeClause,
  isFreeTierUser,
  getFreeAccessConfig,
  clearScopeCache,
} from '../services/channel-scope';

// Freemium boundary: which channel groups a code may watch.
// The helper is the single source of truth shared by the playlist, playback
// token, stream authorization, channel list and category list.

async function setFreeAccess(value: Record<string, unknown>) {
  await AppSetting.updateOne({ key: 'free_access' }, { $set: { value } }, { upsert: true });
  clearScopeCache();
}

describe('normalizeGroupList', () => {
  it('trims, drops empties and dedupes', () => {
    expect(normalizeGroupList([' AR| ALGERIA ', '', 'AR| ALGERIA', 'FR| TF1 '])).toEqual([
      'AR| ALGERIA',
      'FR| TF1',
    ]);
  });

  it('accepts a comma-separated string', () => {
    expect(normalizeGroupList('A, B ,A')).toEqual(['A', 'B']);
  });

  it('treats null/undefined as empty and drops oversized labels', () => {
    expect(normalizeGroupList(null)).toEqual([]);
    expect(normalizeGroupList(undefined)).toEqual([]);
    expect(normalizeGroupList(['x'.repeat(201), 'ok'])).toEqual(['ok']);
  });
});

describe('allowedGroupsForUser', () => {
  beforeEach(async () => {
    clearScopeCache();
  });

  it('never restricts an Admin', async () => {
    expect(await allowedGroupsForUser({ role: 'Admin', accessGroups: ['A'] })).toBeNull();
  });

  it('returns null (unrestricted) for a plain user without groups', async () => {
    expect(await allowedGroupsForUser({ role: 'User', accessGroups: [] })).toBeNull();
  });

  it('scopes a paid code by its accessGroups', async () => {
    expect(await allowedGroupsForUser({ role: 'User', accessGroups: ['SPORT'] })).toEqual(['SPORT']);
  });

  it('scopes the free tier by the free_access setting', async () => {
    await setFreeAccess({ enabled: true, channelGroups: ['AR| ALGERIA الجزائر'], showAds: true });
    expect(await allowedGroupsForUser({ role: 'User', freeAccess: true, accessGroups: [] })).toEqual([
      'AR| ALGERIA الجزائر',
    ]);
  });

  it('explicit user groups win over the free_access setting', async () => {
    await setFreeAccess({ enabled: true, channelGroups: ['SETTING'], showAds: true });
    expect(await allowedGroupsForUser({ role: 'User', freeAccess: true, accessGroups: ['EXPLICIT'] })).toEqual([
      'EXPLICIT',
    ]);
  });

  it('enabled with no groups = the free tier sees the whole catalog', async () => {
    await setFreeAccess({ enabled: true, channelGroups: [], showAds: true });
    expect(await allowedGroupsForUser({ role: 'User', freeAccess: true, accessGroups: [] })).toBeNull();
  });

  it('falls back to the legacy demo groups while the panel tier is off', async () => {
    await setFreeAccess({ enabled: false, channelGroups: ['PANEL'], showAds: true });
    const groups = await allowedGroupsForUser({ role: 'Demo', demo: true, accessGroups: [] });
    expect(groups).not.toEqual(['PANEL']);
    expect((groups || []).length).toBeGreaterThan(0);
  });

  it('falls back to the legacy demo groups for the demo code', async () => {
    const groups = await allowedGroupsForUser({ role: 'Demo', demo: true, accessGroups: [] });
    expect(Array.isArray(groups)).toBe(true);
    expect((groups || []).length).toBeGreaterThan(0);
  });

  it('isFreeTierUser recognises demo and freeAccess', () => {
    expect(isFreeTierUser({ demo: true })).toBe(true);
    expect(isFreeTierUser({ freeAccess: true })).toBe(true);
    expect(isFreeTierUser({ role: 'User' })).toBe(false);
    expect(isFreeTierUser(null)).toBe(false);
  });

  it('getFreeAccessConfig defaults to enabled-free with ads on', async () => {
    const config = await getFreeAccessConfig();
    expect(config.showAds).toBe(true);
    expect(Array.isArray(config.channelGroups)).toBe(true);
  });
});

describe('channel scope enforcement helpers', () => {
  it('isChannelAllowedForUser allows anything when unrestricted', async () => {
    expect(await isChannelAllowedForUser({ role: 'Admin' }, { channelGroup: 'X' })).toBe(true);
    expect(await isChannelAllowedForUser({ role: 'User', accessGroups: [] }, { channelGroup: 'X' })).toBe(true);
  });

  it('isChannelAllowedForUser matches the exact group label', async () => {
    const user = { role: 'User', accessGroups: ['SPORT'] };
    expect(await isChannelAllowedForUser(user, { channelGroup: 'SPORT' })).toBe(true);
    expect(await isChannelAllowedForUser(user, { channelGroup: 'MOVIES' })).toBe(false);
    expect(await isChannelAllowedForUser(user, {})).toBe(false);
  });

  it('applyGroupScope merges a $in clause and leaves unrestricted queries alone', async () => {
    const scoped: Record<string, unknown> = { isActive: { $ne: false } };
    await applyGroupScope({ role: 'User', accessGroups: ['SPORT'] }, scoped);
    expect(scoped.channelGroup).toEqual({ $in: ['SPORT'] });

    const open: Record<string, unknown> = { isActive: { $ne: false } };
    expect(await applyGroupScope({ role: 'Admin' }, open)).toBe(open);
    expect(open.channelGroup).toBeUndefined();
  });

  it('groupScopeClause returns null when unrestricted', async () => {
    expect(await groupScopeClause({ role: 'Admin' })).toBeNull();
    expect(await groupScopeClause({ role: 'User', accessGroups: ['A'] })).toEqual({
      channelGroup: { $in: ['A'] },
    });
  });
});
