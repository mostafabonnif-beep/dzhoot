import { act, render, screen } from '@testing-library/react';
import Home from '../app/page';

// Home renders <ShopPlans />, which fetches plan data on mount. The global
// fetch stub (src/test/setup.ts) resolves immediately with a fallback
// payload, so we flush that microtask chain inside `act` before asserting —
// this avoids the "update not wrapped in act(...)" warning from ShopPlans'
// post-mount setError/setData calls.
async function renderHome() {
  await act(async () => {
    render(<Home />);
  });
}

describe('Home page', () => {
  it('renders the branded home link', async () => {
    await renderHome();

    expect(screen.getByRole('link', { name: 'DZ HOOF' })).toHaveAttribute('href', '/');
  });

  it('renders calls to action that lead to the purchase flow', async () => {
    await renderHome();

    const purchaseLinks = screen.getAllByRole('link', { name: 'اشترك الآن' });
    expect(purchaseLinks.length).toBeGreaterThan(0);
    purchaseLinks.forEach((link) => expect(link).toHaveAttribute('href', '/buy'));
    expect(screen.getByRole('link', { name: 'شاهد الأسعار' })).toHaveAttribute('href', '#pricing');
  });
});
