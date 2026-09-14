import { render, screen } from '@testing-library/react';
import ResourcesPage from '../app/(dashboard)/admin/resources/page';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'nav.resources': 'الموارد والاستهلاك',
      };
      return map[key] || key;
    },
    locale: 'ar',
    dir: 'rtl',
  }),
}));

const mockedGet = api.get as jest.Mock;

const RESOURCES_PAYLOAD = {
  success: true,
  data: {
    now: {
      concurrentTotal: 42,
      concurrentFree: 30,
      concurrentPaid: 12,
      concurrentAdmin: 0,
      concurrentUnknown: 0,
      egressLast60sMb: 12.4,
      egressMbps: 1.65,
      egressTodayGb: 18.7,
      activeSources: 0,
    },
    peak: { concurrencyToday: 87, mbpsToday: 12.4 },
    byTier: {
      free: { concurrent: 30, egressTodayGb: 6.2 },
      paid: { concurrent: 12, egressTodayGb: 12.5 },
      admin: { concurrent: 0, egressTodayGb: 0 },
      unknown: { concurrent: 0, egressTodayGb: 0 },
    },
    bySource: [],
    byPath: { proxy: { egressTodayGb: 9.1 }, remux: { egressTodayGb: 0.4 } },
    topChannels: [{ name: 'beIN 1', concurrent: 12 }],
    redisAvailable: true,
    series: [{ ts: '2026-09-13T10:00:00.000Z', egressGb: 2.1 }],
    history: [
      {
        day: '2026-09-13',
        peakConcurrency: 87,
        peakMbps: 12.4,
        egressGb: 18.7,
        freeConcurrent: 30,
        paidConcurrent: 12,
      },
    ],
  },
};

const RESOURCES_RESPONSE = { data: RESOURCES_PAYLOAD };

describe('Admin resources page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGet.mockResolvedValue(RESOURCES_RESPONSE);
  });

  it('renders the KPI cards from the API payload', async () => {
    render(<ResourcesPage />);

    // Concurrent total / free viewers / today's egress.
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getAllByText('30').length).toBeGreaterThan(0);
    expect(screen.getAllByText('18.7').length).toBeGreaterThan(0);

    // Arabic KPI labels.
    expect(screen.getByText('المشاهدون الآن')).toBeInTheDocument();
    expect(screen.getByText('مجاني')).toBeInTheDocument();
    expect(screen.getByText('مدفوع')).toBeInTheDocument();
    expect(screen.getByText('Mbps الآن')).toBeInTheDocument();
    expect(screen.getByText('استهلاك اليوم (GB)')).toBeInTheDocument();
    expect(screen.getByText('ذروة اليوم (مشاهدون)')).toBeInTheDocument();

    // Tier sub-labels and top-channel row.
    expect(screen.getByText('اليوم: 6.2 GB')).toBeInTheDocument();
    expect(screen.getByText('beIN 1')).toBeInTheDocument();

    // Auto-refresh toggle is visible and enabled by default.
    expect(screen.getByText(/تحديث تلقائي/)).toBeInTheDocument();

    // Redis is available in this payload, so no warning banner.
    expect(screen.queryByText(/Redis غير متاح/)).not.toBeInTheDocument();
  });

  it('shows the Redis warning banner when Redis is unavailable', async () => {
    mockedGet.mockResolvedValue({
      data: {
        ...RESOURCES_PAYLOAD,
        data: { ...RESOURCES_PAYLOAD.data, redisAvailable: false },
      },
    });
    render(<ResourcesPage />);

    expect(
      await screen.findByText('Redis غير متاح — الأرقام المعروضة جزئية'),
    ).toBeInTheDocument();
  });

  it('shows an error state with a retry button when the request fails', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    render(<ResourcesPage />);

    expect(await screen.findByText('تعذر تحميل بيانات الموارد')).toBeInTheDocument();
    expect(screen.getByText('إعادة المحاولة')).toBeInTheDocument();
  });
});
