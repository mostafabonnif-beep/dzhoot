import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ChannelsPageShell from '../components/channels-page-shell';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('@/store/auth-store', () => ({
  useAuthStore: () => ({ user: { channelListCode: 'demo-code' } }),
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({
    locale: 'ar',
    t: (key: string) => {
      const map: Record<string, string> = {
        'channels.myChannels': 'القنوات',
        'channels.totalCount': 'إجمالي القنوات: {count}',
        'nav.quickPick': 'اختيار سريع',
        'channels.addStream': 'إضافة قناة',
        'channels.importM3u': 'استيراد M3U',
        'channels.exportM3u': 'تصدير M3U',
        'channels.testAll': 'اختبار الكل',
        'channels.deleteAll': 'حذف الكل',
        'channels.search': 'ابحث في القنوات',
        'channels.working': 'تعمل: {count}',
        'channels.notWorking': 'متوقفة: {count}',
        'channels.untested': 'غير مختبرة: {count}',
        'channels.clearStatusFilter': 'مسح الفلتر',
      };
      return map[key] || key;
    },
  }),
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/hooks/use-debounced-search', () => ({
  useDebouncedSearch: () => ({
    search: '',
    debouncedSearch: '',
    handleSearchChange: jest.fn(),
  }),
}));

jest.mock('@/hooks/use-client-side-table', () => ({
  useClientSideTable: () => ({ filtered: [], paginated: [] }),
}));

jest.mock('@/components/stream-player-context', () => ({
  useStreamPlayer: () => ({ playStream: jest.fn() }),
}));

jest.mock('@/components/ui/confirm-dialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/ui/pagination', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/ui/modal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/ui/column-filter', () => ({
  __esModule: true,
  default: ({ label }: { label: string }) => <span>{label}</span>,
}));

jest.mock('@/components/ui/search-input', () => ({
  __esModule: true,
  default: ({ ariaLabel }: { ariaLabel: string }) => <input aria-label={ariaLabel} />,
}));

jest.mock('@/components/ui/status-dot', () => ({
  __esModule: true,
  default: () => <span>status-dot</span>,
}));

jest.mock('@/components/ui/channel-data-table', () => ({
  __esModule: true,
  default: ({ data, onDetail }: any) => (
    <div>
      <div>rows:{data.length}</div>
      {data[0] && (
        <button onClick={() => onDetail?.(data[0])}>show-first-detail</button>
      )}
    </div>
  ),
}));

jest.mock('@/components/ui/channel-logo', () => ({
  __esModule: true,
  default: () => <span>logo</span>,
}));

jest.mock('@/components/channel-detail-modal', () => ({
  __esModule: true,
  default: ({ open, fields }: any) =>
    open ? (
      <div data-testid="channel-detail-modal">
        {fields.map((field: any) => (
          <div key={field.label}>{`${field.label}: ${field.value}`}</div>
        ))}
      </div>
    ) : null,
}));

const mockedGet = api.get as jest.Mock;

describe('Admin channels page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGet.mockImplementation((url: string) => {
      if (url === '/favorites') {
        return Promise.resolve({ data: { channel_ids: [] } });
      }
      if (url === '/admin/channels/filter-options') {
        return Promise.resolve({
          data: { data: { group: ['Sports', 'News'], status: ['Live', 'Dead', 'Untested'], language: ['ar'], country: ['DZ'] } },
        });
      }
      if (url.startsWith('/admin/channels?')) {
        return Promise.resolve({
          data: {
            data: [
              {
                _id: 'c1',
                channelId: 'bein-1',
                channelName: 'BeIN Sports 1',
                channelGroup: 'Sports',
                epgId: 'beinsports1.ar',
                catchup: { type: 'timeshift', days: 3 },
                metadata: { isWorking: true },
                alternateStreams: [{ streamUrl: 'https://backup.example.com/1.m3u8' }],
              },
              {
                _id: 'c2',
                channelId: 'entv',
                channelName: 'ENTV',
                channelGroup: 'News',
                flaggedBad: { isFlagged: true },
                metadata: { isWorking: false },
                alternateStreams: [],
              },
              {
                _id: 'c3',
                channelId: 'kids-one',
                channelName: 'Kids One',
                channelGroup: 'Kids',
                metadata: {},
              },
            ],
            totalCount: 3,
            health: { working: 1, notWorking: 1, untested: 1 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it('renders catalog operational summary with catchup and EPG indicators', async () => {
    render(<ChannelsPageShell mode="admin" />);

    const summaryTitle = await screen.findByText('ملخص تشغيلي للكتالوج');
    const summarySection = summaryTitle.closest('section');

    expect(summaryTitle).toBeInTheDocument();
    expect(screen.getByText('تحتاج معالجة تشغيلية')).toBeInTheDocument();
    expect(summarySection).not.toBeNull();
    expect(summarySection?.textContent).toContain('جاهزة لـ Catch-up');
    expect(summarySection?.textContent).toContain('مرتبطة بـ EPG');
    expect(summarySection?.textContent).toContain('قنوات مُعلّمة كمشكلة');
    expect(summarySection?.textContent).toContain('بث بديل جاهز');
    expect(screen.getByLabelText('ابحث في القنوات')).toBeInTheDocument();
    expect(screen.getByText('rows:3')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalled();
    });
  });

  it('shows EPG and catchup details in the admin channel detail modal', async () => {
    render(<ChannelsPageShell mode="admin" />);

    await screen.findByText('rows:3');
    fireEvent.click(screen.getByText('show-first-detail'));

    const modal = await screen.findByTestId('channel-detail-modal');
    expect(modal.textContent).toContain('جاهزية التايم شيفت: جاهزة للتايم شيفت من الدليل');
    expect(modal.textContent).toContain('معرّف EPG: beinsports1.ar');
    expect(modal.textContent).toContain('وضع Catch-up: تايم شيفت');
    expect(modal.textContent).toContain('نافذة Catch-up: 3 يوم');
  });

  it('filters the admin list by catchup readiness from the summary chips', async () => {
    render(<ChannelsPageShell mode="admin" />);

    await screen.findByText('rows:3');
    fireEvent.click(screen.getByRole('button', { name: /جاهزة لـ Catch-up/i }));
    expect(screen.getByText('rows:1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /عرض كل القنوات/i }));
    expect(screen.getByText('rows:3')).toBeInTheDocument();
  });

  it('filters the admin list by combined timeshift and EPG readiness', async () => {
    render(<ChannelsPageShell mode="admin" />);

    await screen.findByText('rows:3');
    fireEvent.click(screen.getByRole('button', { name: /جاهزة للتايم شيفت مع EPG/i }));
    expect(screen.getByText('rows:1')).toBeInTheDocument();
  });
});
