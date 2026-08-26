import { render, screen } from '@testing-library/react';
import Home from '../app/page';

describe('Home page', () => {
  it('renders the branded home link', () => {
    render(<Home />);

    expect(screen.getByRole('link', { name: 'DZ HOOF' })).toHaveAttribute('href', '/');
  });

  it('renders calls to action that lead to the purchase flow', () => {
    render(<Home />);

    const purchaseLinks = screen.getAllByRole('link', { name: 'اشترك الآن' });
    expect(purchaseLinks.length).toBeGreaterThan(0);
    purchaseLinks.forEach((link) => expect(link).toHaveAttribute('href', '/buy'));
    expect(screen.getByRole('link', { name: 'شاهد الأسعار' })).toHaveAttribute('href', '#pricing');
  });
});
