import { render, screen, waitFor } from '@testing-library/react';
import SourcesPageShell from '../components/sources-page-shell';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({
    locale: 'ar',
    t: (key: string) => {
      const map: Record<string, string> = {
        'sources.title': 'المصادر الخارجية',
        'sources.adminDescription': 'إدارة مصادر القنوات الخارجية',
      };
      return map[key] || key;
    },
  }),
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/hooks/use-bulk-selection', () => ({
  useBulkSelection: () => ({
    count: 2,
    isSelected: () => true,
    unselectAll: jest.fn(),
    toggleOne: jest.fn(),
    selectMany: jest.fn(),
    unselectMany: jest.fn(),
  }),
}));

jest.mock('@/components/stream-player-context', () => ({
  useStreamPlayer: () => ({ playStream: jest.fn() }),
}));

jest.mock('@/components/channel-detail-modal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/ui/liveness-stats-bar', () => ({
  __esModule: true,
  default: () => <div>liveness-bar</div>,
}));

jest.mock('@/components/external-source-tab', () => ({
  __esModule: true,
  default: ({ topSlot, children }: any) => (
    <div>
      {topSlot}
      {children({
        channels: [
          {
            _uid: 's1',
            channelName: 'News One',
            channelUrl: 'https://example.com/news.m3u8',
            channelId: 'news-one',
            groupTitle: 'News',
            country: 'DZ',
            liveness: { status: 'alive' },
          },
          {
            _uid: 's2',
            channelName: 'Kids Plus',
            channelUrl: 'https://example.com/kids.m3u8',
            channelId: 'kids-plus',
            groupTitle: 'Kids',
            country: 'DZ',
            liveness: { status: 'dead' },
          },
          {
            _uid: 's3',
            channelName: 'Cinema Mix',
            channelUrl: 'https://example.com/cinema.m3u8',
            channelId: 'cinema-mix',
            groupTitle: 'Movies',
            country: 'FR',
            liveness: { status: 'unknown' },
          },
        ],
        region: 'dz',
        onChannelUpdate: jest.fn(),
      })}
    </div>
  ),
}));

jest.mock('@/components/source-channel-data-table', () => ({
  __esModule: true,
  default: ({ headerSlot, toolbarActions, bannerSlot }: any) => (
    <div>
      {headerSlot}
      <div>{toolbarActions}</div>
      {bannerSlot}
      <div>source-table</div>
    </div>
  ),
}));

const mockedGet = api.get as jest.Mock;

describe('Admin sources page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGet.mockImplementation((url: string) => {
      if (url.startsWith('/external-sources/liveness-status')) {
        return Promise.resolve({
          data: {
            data: {
              livenessStats: { alive: 1, dead: 1, unknown: 1 },
              livenessCheckInProgress: false,
            },
          },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });
  });

  it('renders source operational summary for admins', async () => {
    render(<SourcesPageShell mode="admin" />);

    expect(await screen.findByText('ملخص تشغيلي للمصدر')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('يحتاج تنظيفًا قبل الاستيراد')).toBeInTheDocument();
    });
    expect(screen.getByText('إجمالي القنوات')).toBeInTheDocument();
    expect(screen.getByText('ميتة')).toBeInTheDocument();
    expect(screen.getByText('محددة للاستيراد')).toBeInTheDocument();
    expect(screen.getByText('source-table')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalled();
    });
  });
});
