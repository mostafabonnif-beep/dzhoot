import { render, screen, waitFor } from '@testing-library/react';
import Home from '../app/page';

const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/v1/shop/plans')) {
    return {
      json: async () => ({
        success: true,
        data: { brand: 'DZ HOOF', whatsapp: '213555000111', shop: null, plans: [] },
      }),
    } as Response;
  }

  if (url.includes('/api/v1/payments/chargily/config')) {
    return {
      json: async () => ({ success: true, data: { enabled: false } }),
    } as Response;
  }

  throw new Error(`Unexpected fetch URL: ${url}`);
});

describe('Home page', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as typeof fetch;
  });

  it('renders the branded home link', async () => {
    render(<Home />);

    expect(screen.getByRole('link', { name: 'DZ HOOF' })).toHaveAttribute('href', '/');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('renders calls to action that lead to the purchase flow', async () => {
    render(<Home />);

    const purchaseLinks = screen.getAllByRole('link', { name: 'اشترك الآن' });
    expect(purchaseLinks.length).toBeGreaterThan(0);
    purchaseLinks.forEach((link) => expect(link).toHaveAttribute('href', '/buy'));
    expect(screen.getByRole('link', { name: 'شاهد الأسعار' })).toHaveAttribute('href', '#pricing');
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
