import { render, screen, waitFor } from '@testing-library/react';
import CodesPage from '../app/(dashboard)/admin/codes/page';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({ t: (key: string) => key, locale: 'ar', dir: 'rtl' }),
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockedGet = api.get as jest.Mock;

function mockApiResponses(codes: unknown[], totalCount: number) {
  mockedGet.mockImplementation((url: string) => {
    if (String(url).includes('/stats')) {
      return Promise.resolve({ data: { data: { total: totalCount, byStatus: { UNUSED: 0, ACTIVATED: 0, REVOKED: 0, EXPIRED: 0 } } } });
    }
    if (String(url).includes('/admin/plans')) {
      return Promise.resolve({ data: { data: [] } });
    }
    return Promise.resolve({ data: { data: codes, totalCount, page: 1, limit: 10 } });
  });
}

describe('Admin codes page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the empty state when no activation codes exist', async () => {
    mockApiResponses([], 0);
    render(<CodesPage />);

    expect(await screen.findByText('لم يتم العثور على أكواد.')).toBeInTheDocument();
    // Header still shows the count from the stats payload
    expect(screen.getByText(/0 كود/)).toBeInTheDocument();
  });

  it('renders the codes returned by the API', async () => {
    mockApiResponses(
      [
        { _id: 'c1', prefix: 'DZHF', codeLast4: '1234', status: 'UNUSED', planId: { _id: 'p1', name: '1 Month', durationDays: 30, maxDevices: 2 } },
        { _id: 'c2', prefix: 'DZHF', codeLast4: '5678', status: 'ACTIVATED', planId: { _id: 'p1', name: '1 Month', durationDays: 30, maxDevices: 2 } },
      ],
      2,
    );
    render(<CodesPage />);

    await waitFor(() => expect(screen.getByText('DZHF-••••-••••-1234')).toBeInTheDocument());
    expect(screen.getByText('DZHF-••••-••••-5678')).toBeInTheDocument();
  });

  it('shows an error toast when the codes request fails', async () => {
    const toast = jest.fn();
    (jest.requireMock('@/hooks/use-toast') as { useToast: () => { toast: jest.Mock } }).useToast = () => ({ toast });
    mockedGet.mockImplementation((url: string) => {
      if (String(url).includes('/stats') || String(url).includes('/admin/plans')) {
        return Promise.resolve({ data: { data: null } });
      }
      return Promise.reject({ response: { data: { error: 'Failed to load codes' } } });
    });

    render(<CodesPage />);

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Failed to load codes', 'error'));
  });
});
