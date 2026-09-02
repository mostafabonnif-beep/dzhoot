import { render, screen, waitFor, within } from '@testing-library/react';
import AdminDashboard from '../app/(dashboard)/admin/page';
import api, { getChannelOperations, getEpgCoverage, getPlaybackQuality } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  getChannelOperations: jest.fn(),
  getEpgCoverage: jest.fn(),
  getPlaybackQuality: jest.fn(),
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({
    locale: 'ar',
    dir: 'rtl',
    t: (key: string) => key,
  }),
}));

const mockedGet = api.get as jest.Mock;
const mockedGetChannelOperations = getChannelOperations as jest.Mock;
const mockedGetEpgCoverage = getEpgCoverage as jest.Mock;
const mockedGetPlaybackQuality = getPlaybackQuality as jest.Mock;

describe('Admin dashboard EPG insights', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGet.mockImplementation((url: string) => {
      if (url === '/admin/stats/detailed') {
        return Promise.resolve({
          data: {
            channels: { total: 120, active: 118 },
            users: { total: 42, active: 37 },
            sessions: { active: 11, total: 18 },
            pairings: { today: 3, pending: 1 },
            recentActivity: [],
          },
        });
      }
      if (url === '/config/defaults') {
        return Promise.resolve({ data: { defaultTvCode: '123456', defaultServerUrl: 'https://iptv.ld-11.net' } });
      }
      if (url === '/admin/stats/stream-health') {
        return Promise.resolve({
          data: {
            channels: {
              totalAliveCount: 100,
              totalDeadCount: 8,
              totalUnresponsiveCount: 12,
              totalPlayCount: 420,
            },
          },
        });
      }
      if (url === '/admin/business/summary') {
        return Promise.resolve({
          data: {
            summary: {
              pricesSet: true,
              activatedTotal: 0,
              activatedThisMonth: 0,
              revenueThisMonth: 0,
              revenueTotal: 0,
              activeSubscriptions: 0,
              codesGeneratedThisMonth: 0,
              creditRemaining: 0,
              activeResellers: 0,
            },
            recentActivations: [],
            byReseller: [],
          },
        });
      }
      if (url === '/admin/reseller-debts/summary') {
        return Promise.resolve({ data: { unpaidCount: 0, outstanding: 0 } });
      }

      return Promise.resolve({ data: {} });
    });

    mockedGetChannelOperations.mockResolvedValue({
      channels: { failing: 6 },
      sources: {
        m3u: [{ status: 'Active', syncStatus: 'success' }],
        xtream: [{ status: 'Active', syncStatus: 'error' }],
      },
      epg: {
        sourcesDiscovered: 3,
        lastRefreshErrorCount: 1,
        lastRefreshedAt: '2026-09-02T09:15:00.000Z',
        totalPrograms: 15420,
        channelsWithEpg: 96,
        refreshInProgress: false,
      },
      identities: { total: 0 },
    });

    mockedGetEpgCoverage.mockResolvedValue({
      totalSystemChannels: 120,
      matchedSystemChannels: 96,
      overallCoveragePercent: 80,
      unmatchedChannelCount: 24,
      sources: [
        {
          source: 'epg-primary.xml',
          coveredChannelCount: 70,
          matchedChannelCount: 64,
          coveragePercent: 91,
          unmatchedChannels: ['c1'],
        },
        {
          source: 'epg-backup.xml',
          coveredChannelCount: 38,
          matchedChannelCount: 22,
          coveragePercent: 58,
          unmatchedChannels: ['c2', 'c3', 'c4'],
        },
        {
          source: 'regional.xml',
          coveredChannelCount: 12,
          matchedChannelCount: 10,
          coveragePercent: 83,
          unmatchedChannels: ['c5', 'c6'],
        },
      ],
    });

    mockedGetPlaybackQuality.mockResolvedValue({
      summary: { totalSessions: 0, errorRate: 0, averageStartupTimeMs: 0, bufferingRate: 0 },
      daily: [],
      topErrors: [],
    });
  });

  it('renders the EPG readiness section with weak source prioritization', async () => {
    render(<AdminDashboard />);

    const heading = await screen.findByRole('heading', { name: 'جاهزية دليل البرامج' });
    const section = heading.closest('section');
    expect(section).not.toBeNull();

    const scoped = within(section as HTMLElement);
    expect(scoped.getByText('80%')).toBeInTheDocument();
    expect(scoped.getByText('24')).toBeInTheDocument();
    expect(scoped.getByText('أضعف مصادر EPG')).toBeInTheDocument();
    expect(scoped.getByText('epg-backup.xml')).toBeInTheDocument();
    expect(scoped.getByText('58%')).toBeInTheDocument();
    expect(scoped.getByText('خلاصة تشغيلية')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedGetChannelOperations).toHaveBeenCalled();
      expect(mockedGetEpgCoverage).toHaveBeenCalled();
    });
  });
});
