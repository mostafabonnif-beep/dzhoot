import { applyScopeFilter, canAccess, idsFor } from './content-access';

describe('content access scope helpers', () => {
  const selected = {
    mode: 'selected' as const,
    channelIds: ['channel-1'],
    movieIds: ['movie-1'],
    seriesIds: ['series-1'],
  };

  it('returns null only for unrestricted scopes', () => {
    expect(idsFor({ mode: 'all' }, 'movie')).toBeNull();
    expect(idsFor({ mode: 'none' }, 'movie')).toEqual([]);
    expect(idsFor(selected, 'movie')).toEqual(['movie-1']);
  });

  it('checks selected access by normalized id', () => {
    expect(canAccess(selected, 'channel', 'channel-1')).toBe(true);
    expect(canAccess(selected, 'channel', 'channel-2')).toBe(false);
    expect(canAccess({ mode: 'all' }, 'series', 'series-2')).toBe(true);
    expect(canAccess({ mode: 'none' }, 'series', 'series-2')).toBe(false);
  });

  it('adds an explicit Mongo $in constraint for selected and empty scopes', () => {
    expect(applyScopeFilter({ isActive: true }, selected, 'movie')).toEqual({
      isActive: true,
      _id: { $in: ['movie-1'] },
    });
    expect(applyScopeFilter({ isActive: true }, { mode: 'none' }, 'series')).toEqual({
      isActive: true,
      _id: { $in: [] },
    });
  });

  it('leaves unrestricted filters unchanged', () => {
    const filter = { isActive: true };
    expect(applyScopeFilter(filter, { mode: 'all' }, 'channel')).toBe(filter);
    expect(filter).toEqual({ isActive: true });
  });
});
