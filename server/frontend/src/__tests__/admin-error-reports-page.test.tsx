import { render, screen, waitFor } from '@testing-library/react';
import ErrorReportsPage from '../app/(dashboard)/admin/error-reports/page';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'nav.errorReports': 'بلاغات العملاء',
        'common.refresh': 'تحديث',
        'common.retry': 'إعادة المحاولة',
      };
      return map[key] || key;
    },
    locale: 'ar',
    dir: 'rtl',
  }),
}));

const mockedGet = api.get as jest.Mock;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      success: true,
      data: [
        {
          id: 'r1',
          kind: 'problem',
          reportId: 'DZR-7K3M9Q2P',
          status: 'new',
          createdAt: '2026-09-15T10:00:00.000Z',
          updatedAt: '2026-09-15T10:00:00.000Z',
          appVersion: '1.3.1',
          appVersionCode: 10301,
          platform: 'android-tv',
          deviceModel: 'SM-A057G',
          deviceBrand: 'samsung',
          androidVersion: '14',
          sdkInt: 34,
          deviceId: 'dz-0018a80af2a8f852',
          feature: 'player',
          screen: 'channel_detail',
          errorCode: 'PLAYBACK_FAILED',
          severity: 'error',
          retryable: true,
          correlationId: 'corr-1',
          dedupeKey: 'PLAYBACK_FAILED|player|10301',
          message: 'القناة لا تعمل عند فتحها',
          diagnostics: { serverVersion: '1.0.1' },
          adminNotes: null,
          resolvedInVersion: null,
        },
        {
          id: 'c1',
          kind: 'crash',
          reportId: 'CR-ABC12345',
          status: 'new',
          createdAt: '2026-09-12T16:46:11.000Z',
          updatedAt: '2026-09-12T16:46:11.000Z',
          appVersion: '1.0.48',
          appVersionCode: 10048,
          platform: 'android',
          deviceModel: 'SM-A057G',
          deviceBrand: 'samsung',
          androidVersion: '14',
          sdkInt: 34,
          deviceId: 'dz-0018a80af2a8f852',
          feature: null,
          screen: null,
          errorCode: null,
          severity: null,
          retryable: null,
          correlationId: null,
          dedupeKey: 'java.lang.IllegalArgumentException|10048',
          message: 'Only VectorDrawables and rasterized asset types are supported',
          diagnostics: { exceptionType: 'java.lang.IllegalArgumentException' },
          adminNotes: null,
          resolvedInVersion: null,
        },
      ],
      groups: [
        {
          errorCode: 'PLAYBACK_FAILED',
          feature: 'player',
          appVersionCode: 10301,
          count: 4,
          deviceCount: 3,
          lastSeenAt: '2026-09-15T10:00:00.000Z',
        },
      ],
      statusCounts: { new: 2 },
      ...overrides,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('admin error reports page', () => {
  // The whole point of the page: the automatic crash reports were write-only until now.
  // Five real crashes sat unread in production because no surface listed them.
  it('lists customer reports and automatically captured crashes together', async () => {
    mockedGet.mockResolvedValue(payload());

    render(<ErrorReportsPage />);

    expect(await screen.findByText('DZR-7K3M9Q2P')).toBeInTheDocument();
    expect(screen.getByText('CR-ABC12345')).toBeInTheDocument();
    // Both the list badge and the detail-kind row can show it; the list is what matters.
    expect(screen.getAllByText('عطل تلقائي').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Only VectorDrawables and rasterized asset types are supported'),
    ).toBeInTheDocument();
  });

  it('shows the failure classes that keep recurring', async () => {
    mockedGet.mockResolvedValue(payload());

    render(<ErrorReportsPage />);

    // One chip in the recurring-failures panel, one in the list row.
    expect((await screen.findAllByText('PLAYBACK_FAILED')).length).toBeGreaterThan(0);
    expect(screen.getByText(/4 بلاغ/)).toBeInTheDocument();
    expect(screen.getByText(/3 جهاز/)).toBeInTheDocument();
  });

  // The tickets page renders its empty state on a failed request, so a 500 looks exactly
  // like "no tickets". This page must not repeat that.
  it('surfaces a failed request instead of showing an empty list', async () => {
    mockedGet.mockRejectedValue({ response: { status: 500 } });

    render(<ErrorReportsPage />);

    await waitFor(() => expect(screen.getByText(/فشل الطلب/)).toBeInTheDocument());
    expect(screen.queryByText('لا توجد بلاغات مطابقة.')).not.toBeInTheDocument();
  });

  it('explains an expired session rather than staying blank', async () => {
    mockedGet.mockRejectedValue({ response: { status: 401 } });

    render(<ErrorReportsPage />);

    await waitFor(() => expect(screen.getByText(/انتهت الجلسة/)).toBeInTheDocument());
  });

  it('shows the version, device and feature context an operator triages by', async () => {
    mockedGet.mockResolvedValue(payload());

    render(<ErrorReportsPage />);

    // The list carries them so a report is actionable without opening it.
    await screen.findByText('DZR-7K3M9Q2P');
    expect(screen.getAllByText('SM-A057G').length).toBeGreaterThan(0);
    expect(screen.getByText('v10301')).toBeInTheDocument();
  });
});
