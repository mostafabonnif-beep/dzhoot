import { render, screen, waitFor } from '@testing-library/react';
import PlansPage from '../app/(dashboard)/admin/plans/page';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'admin.plans': 'الباقات',
        'admin.newPlan': 'باقة جديدة',
        'common.noData': 'لا توجد بيانات',
        'common.edit': 'تعديل',
        'common.save': 'حفظ',
        'common.saving': 'جارٍ الحفظ',
        'common.cancel': 'إلغاء',
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

describe('Admin plans page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGet.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'p1',
            name: 'شهرية',
            durationDays: 30,
            maxDevices: 2,
            maxConcurrentStreams: 1,
            price: 1200,
            currency: 'DZD',
            status: 'Active',
            codeCount: 10,
            usedCodeCount: 4,
            activeSubs: 8,
          },
          {
            _id: 'p2',
            name: 'سنوية',
            durationDays: 365,
            maxDevices: 4,
            maxConcurrentStreams: 2,
            price: 9000,
            currency: 'DZD',
            status: 'Inactive',
            codeCount: 5,
            usedCodeCount: 1,
            activeSubs: 0,
          },
        ],
        totalCount: 2,
      },
    });
  });

  it('renders plan summary cards and rows from the API', async () => {
    render(<PlansPage />);

    expect(await screen.findByText('شهرية')).toBeInTheDocument();
    expect(screen.getByText('سنوية')).toBeInTheDocument();
    expect(screen.getByText('إجمالي الباقات')).toBeInTheDocument();
    expect(screen.getByText('الباقات النشطة')).toBeInTheDocument();
    expect(screen.getByText('الباقات غير النشطة')).toBeInTheDocument();
    expect(screen.getByText('الأكواد المستخدمة')).toBeInTheDocument();
    expect(screen.getByText('الاشتراكات النشطة')).toBeInTheDocument();
    expect(screen.getByText('5/15')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows the empty state when there are no plans', async () => {
    mockedGet.mockResolvedValueOnce({ data: { data: [], totalCount: 0 } });
    render(<PlansPage />);

    await waitFor(() => expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument());
  });
});
