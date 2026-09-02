import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EpgPage from '../app/(dashboard)/admin/epg/page';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({ locale: 'ar', dir: 'rtl' }),
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/components/ui/confirm-dialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/ui/pagination', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedGet = api.get as jest.Mock;

describe('Admin EPG page', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGet.mockImplementation((url: string) => {
      if (url === '/epg/status') {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              totalPrograms: 15420,
              channelsWithEpg: 96,
              totalSystemChannels: 120,
              lastRefreshedAt: '2026-09-02T09:15:00.000Z',
              nextRefreshAt: '2026-09-02T15:15:00.000Z',
              sourcesDiscovered: 3,
              refreshInProgress: false,
              lastRefreshErrorCount: 1,
              lastRefreshErrorSources: ['epg-backup.xml'],
            },
          },
        });
      }

      if (url === '/epg/sources') {
        return Promise.resolve({
          data: {
            success: true,
            data: [
              {
                url: 'https://cdn.example.com/epg-primary.xml',
                source: 'custom:epg-primary.xml',
                coveredChannels: 70,
                disabled: false,
                lastOkAt: '2026-09-02T09:10:00.000Z',
                lastFailedAt: null,
                lastError: null,
              },
              {
                url: 'https://cdn.example.com/epg-backup.xml',
                source: 'custom:epg-backup.xml',
                coveredChannels: 38,
                disabled: false,
                lastOkAt: '2026-09-01T10:00:00.000Z',
                lastFailedAt: '2026-09-02T09:12:00.000Z',
                lastError: 'timeout',
              },
            ],
          },
        });
      }

      if (url === '/epg/unmatched-channels') {
        return Promise.resolve({
          data: {
            data: [
              {
                _id: 'u1',
                channelId: 'bein-news',
                channelName: 'beIN News',
                tvgId: '',
                channelGroup: 'News',
              },
              {
                _id: 'u2',
                channelId: 'bein-sports-1',
                channelName: 'beIN Sports 1',
                tvgId: 'bein.sports.1',
                channelGroup: 'Sports',
              },
              {
                _id: 'u3',
                channelId: 'canal-kids',
                channelName: 'Canal Kids',
                tvgId: '',
                channelGroup: 'Kids',
              },
            ],
            totalCount: 3,
          },
        });
      }

      return Promise.resolve({ data: {} });
    });
  });

  it('shows operational EPG readiness insights and group summary', async () => {
    render(<EpgPage />);

    expect(await screen.findByText('ملخص تشغيلي')).toBeInTheDocument();
    expect(screen.getByText('يحتاج ضبطًا محدودًا')).toBeInTheDocument();
    expect(screen.getByText('عرض القنوات بلا tvg-id فقط')).toBeInTheDocument();
    expect(screen.getAllByText(/بدون tvg-id/).length).toBeGreaterThan(0);
    expect(screen.getByText((content) => content.includes('بمعرّف موجود'))).toBeInTheDocument();
    expect(screen.getByText('Sports')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
    expect(screen.getByText('Kids')).toBeInTheDocument();
    expect(screen.getAllByText('مفقود').length).toBeGreaterThan(0);
  });

  it('filters unmatched rows to channels without tvg-id only', async () => {
    render(<EpgPage />);

    expect(await screen.findByText('beIN Sports 1')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('عرض القنوات بلا tvg-id فقط'));

    await waitFor(() => {
      expect(screen.queryByText('beIN Sports 1')).not.toBeInTheDocument();
    });

    expect(screen.getByText('beIN News')).toBeInTheDocument();
    expect(screen.getByText('Canal Kids')).toBeInTheDocument();
  });
});
