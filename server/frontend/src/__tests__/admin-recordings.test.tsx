import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RecordingsPage from '../app/(dashboard)/admin/recordings/page';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const sampleRecordings = [
  {
    _id: 'r1',
    channelId: 'c1',
    channelName: 'BeIN Sports 1',
    channelGroup: 'Sports',
    slug: 'bein-1',
    status: 'recording',
    startedAt: '2026-09-02T10:00:00.000Z',
  },
  {
    _id: 'r2',
    channelId: 'c2',
    channelName: 'ENTV',
    channelGroup: 'News',
    slug: 'entv',
    status: 'ready',
    startedAt: '2026-09-02T08:00:00.000Z',
    durationSec: 1800,
    sizeBytes: 800000000,
    fileName: 'entv.mp4',
  },
  {
    _id: 'r3',
    channelId: 'c3',
    channelName: 'Cinema One',
    channelGroup: 'Movies',
    slug: 'cinema-one',
    status: 'failed',
    startedAt: '2026-09-02T06:00:00.000Z',
    error: 'انقطع البث أثناء التسجيل',
  },
];

describe('Admin recordings page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGet.mockResolvedValue({
      data: {
        data: sampleRecordings,
        stats: { active: 1, total: 3, totalSizeBytes: 800000000 },
      },
    });
    mockedDelete.mockResolvedValue({ data: { success: true } });
    window.confirm = jest.fn(() => true);
  });

  it('renders recordings stats, operational summary, and rows from the API', async () => {
    render(<RecordingsPage />);

    expect(await screen.findByText('BeIN Sports 1')).toBeInTheDocument();
    expect(screen.getByText('ENTV')).toBeInTheDocument();
    expect(screen.getByText('Cinema One')).toBeInTheDocument();
    expect(screen.getByText('إجمالي التسجيلات')).toBeInTheDocument();
    expect(screen.getByText('ملخص تشغيلي')).toBeInTheDocument();
    expect(screen.getByText('تحتاج متابعة تشغيلية')).toBeInTheDocument();
    expect(screen.getByText('جاهزة للتحميل')).toBeInTheDocument();
    expect(screen.getByLabelText('ابحث داخل التسجيلات')).toBeInTheDocument();
    expect(screen.getByText('يجري التحديث تلقائيًا كل 15 ثانية أثناء التسجيل النشط.')).toBeInTheDocument();
  });

  it('filters the list by selected status', async () => {
    render(<RecordingsPage />);
    await screen.findByText('BeIN Sports 1');

    fireEvent.click(screen.getByRole('button', { name: /الجاهزة/ }));

    expect(screen.queryByText('BeIN Sports 1')).not.toBeInTheDocument();
    expect(screen.getByText('ENTV')).toBeInTheDocument();
    expect(screen.queryByText('Cinema One')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /الفاشلة/ }));

    expect(screen.getByText('Cinema One')).toBeInTheDocument();
    expect(screen.getByText('انقطع البث أثناء التسجيل')).toBeInTheDocument();
  });

  it('deletes a recording and reloads the list', async () => {
    render(<RecordingsPage />);
    const entvLabel = await screen.findByText('ENTV');

    const entvRow = entvLabel.closest('tr');
    expect(entvRow).not.toBeNull();
    const deleteButton = entvRow?.querySelector('button[aria-label="حذف"]') as HTMLButtonElement;
    fireEvent.click(deleteButton);

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('/admin/recordings/r2'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByText('تم حذف تسجيل: ENTV')).toBeInTheDocument();
  });

  it('filters recordings by search query inside the table', async () => {
    render(<RecordingsPage />);
    await screen.findByText('BeIN Sports 1');

    fireEvent.change(screen.getByLabelText('ابحث داخل التسجيلات'), { target: { value: 'Movies' } });

    expect(screen.queryByText('BeIN Sports 1')).not.toBeInTheDocument();
    expect(screen.queryByText('ENTV')).not.toBeInTheDocument();
    expect(screen.getByText('Cinema One')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('ابحث داخل التسجيلات'), { target: { value: 'غير موجود' } });
    expect(screen.getByText('لا توجد تسجيلات مطابقة للبحث الحالي')).toBeInTheDocument();
  });
});
