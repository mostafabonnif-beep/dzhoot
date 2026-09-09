import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import UserVodBrowser from '../components/user-vod-browser';
import api from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() },
}));

jest.mock('@/components/locale-provider', () => ({
  useLocale: () => ({ locale: 'ar', t: (key: string) => key }),
}));

// hls.js touches MediaSource APIs at module scope; the player only mounts on
// demand, so keep the import side-effect free in jsdom.
jest.mock('hls.js', () => ({
  __esModule: true,
  default: class {
    static isSupported() {
      return false;
    }
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

const mockedGet = api.get as jest.Mock;

const movie = {
  _id: 'm1',
  title: 'فيلم تجريبي',
  poster: 'https://img.example/p.jpg',
  category: 'أكشن',
  duration: 7260,
};
const series = { _id: 's1', title: 'مسلسل تجريبي', poster: '', category: 'دراما' };

function mockCatalog(kind: 'movies' | 'series', rows: unknown[], total = rows.length) {
  mockedGet.mockImplementation((url: string) => {
    if (url.includes(`/catalog/${kind}/categories`)) {
      return Promise.resolve({ data: { success: true, data: [{ name: 'أكشن', count: 1 }] } });
    }
    if (url.includes(`/catalog/${kind}`)) {
      return Promise.resolve({ data: { success: true, data: rows, totalCount: total } });
    }
    return Promise.resolve({ data: { success: true, data: [] } });
  });
}

describe('UserVodBrowser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCatalog('movies', [movie]);
  });

  it('renders the movie grid with titles and tab switcher', async () => {
    render(<UserVodBrowser />);
    expect(screen.getByText('مكتبة الأفلام والمسلسلات')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('فيلم تجريبي')).toBeInTheDocument());
    // tabs present
    expect(screen.getByText('أفلام')).toBeInTheDocument();
    expect(screen.getByText('مسلسلات')).toBeInTheDocument();
  });

  it('switches to the series catalog when the series tab is clicked', async () => {
    render(<UserVodBrowser />);
    await waitFor(() => expect(screen.getByText('فيلم تجريبي')).toBeInTheDocument());
    mockCatalog('series', [series]);
    fireEvent.click(screen.getByText('مسلسلات'));
    await waitFor(() => expect(screen.getByText('مسلسل تجريبي')).toBeInTheDocument());
  });

  it('shows the load-more footer when more items exist than rendered', async () => {
    const many = Array.from({ length: 24 }, (_, i) => ({ ...movie, _id: `m${i}` }));
    mockCatalog('movies', many, 60);
    render(<UserVodBrowser />);
    await waitFor(() => expect(screen.getByText('عرض المزيد')).toBeInTheDocument());
  });

  it('renders the empty state when the catalog has no items', async () => {
    mockCatalog('movies', [], 0);
    render(<UserVodBrowser />);
    await waitFor(() => expect(screen.getByText('لا توجد أفلام مطابقة.')).toBeInTheDocument());
  });

  it('surfaces an error message when the catalog request fails', async () => {
    mockedGet.mockRejectedValue(new Error('network'));
    render(<UserVodBrowser />);
    await waitFor(() => expect(screen.getByText('تعذّر تحميل المحتوى. حاول مرة أخرى.')).toBeInTheDocument());
  });

  it('preselects the series tab when initialKind=series is given', async () => {
    mockCatalog('series', [series]);
    render(<UserVodBrowser initialKind="series" />);
    await waitFor(() => expect(screen.getByText('مسلسل تجريبي')).toBeInTheDocument());
  });

  it('opens the episodes drill-down when a series card is clicked', async () => {
    const season = { _id: 'sea1', seasonNumber: 1, name: 'الموسم 1' };
    const episode = { _id: 'ep1', episodeNumber: 1, title: 'الحلقة الأولى', duration: 2400 };
    mockedGet.mockImplementation((url: string) => {
      // most specific paths first — the generic `/catalog/series` branch below
      // also matches `/catalog/series/:id/seasons`
      if (url.includes('/catalog/series/s1/seasons')) {
        return Promise.resolve({ data: { success: true, data: [season] } });
      }
      if (url.includes('/catalog/seasons/sea1/episodes')) {
        return Promise.resolve({ data: { success: true, data: [episode] } });
      }
      if (url.includes('/catalog/series/categories')) {
        return Promise.resolve({ data: { success: true, data: [] } });
      }
      if (url.includes('/catalog/series')) {
        return Promise.resolve({ data: { success: true, data: [series], totalCount: 1 } });
      }
      return Promise.resolve({ data: { success: true, data: [] } });
    });
    render(<UserVodBrowser />);
    // initial tab is movies — switch to series first
    await waitFor(() => expect(screen.getByText('لا توجد أفلام مطابقة.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('مسلسلات'));
    await waitFor(() => expect(screen.getByText('مسلسل تجريبي')).toBeInTheDocument());
    fireEvent.click(screen.getByText('مسلسل تجريبي'));
    await waitFor(() => expect(screen.getByText('الحلقة الأولى')).toBeInTheDocument());
  });
});
