import { render, screen, waitFor } from '@testing-library/react';
import AdminTicketsPage from '../app/(dashboard)/admin/tickets/page';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'portal.ticketEmpty': 'لا توجد تذاكر بعد.',
        'portal.ticketLoadFailed': 'تعذّر تحميل التذاكر. أعد المحاولة.',
        'nav.dashboard': 'الكل',
        'portal.ticketSubject': 'الموضوع',
        'resellers.count': 'الموزّعون',
        'portal.ticketPriority': 'الأولوية',
        'portal.ledgerStatus': 'الحالة',
        'portal.ledgerDate': 'التاريخ',
      };
      return map[key] || key;
    },
    locale: 'ar',
    dir: 'rtl',
  }),
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockedGet = api.get as jest.Mock;

/**
 * A failed request must not read as "no tickets yet".
 *
 * The page used to catch every failure and render an empty list, so a 401 (expired session),
 * a 403 or a 500 were indistinguishable from a genuinely empty inbox — which is exactly when
 * someone opens this page. These cases pin the behaviour: the failure is shown, the empty
 * state is not.
 */
describe('admin tickets page', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('shows the failure instead of an empty inbox when the request fails', async () => {
    mockedGet.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Internal Server Error' } },
    });

    render(<AdminTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText(/خطأ في الخادم \(500\)/)).toBeInTheDocument();
    });
    expect(screen.queryByText('لا توجد تذاكر بعد.')).not.toBeInTheDocument();
  });

  it('tells the operator to sign in again on a 401', async () => {
    mockedGet.mockRejectedValueOnce({ response: { status: 401, data: { error: 'Unauthorized' } } });

    render(<AdminTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText(/401/)).toBeInTheDocument();
    });
    expect(screen.queryByText('لا توجد تذاكر بعد.')).not.toBeInTheDocument();
  });

  it('still shows the empty state when the request succeeds with no rows', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { data: [], summary: { OPEN: 0, PENDING: 0, CLOSED: 0 } },
    });

    render(<AdminTicketsPage />);

    await waitFor(() => {
      expect(screen.getByText('لا توجد تذاكر بعد.')).toBeInTheDocument();
    });
    expect(screen.queryByText(/خطأ في الخادم/)).not.toBeInTheDocument();
  });
});
