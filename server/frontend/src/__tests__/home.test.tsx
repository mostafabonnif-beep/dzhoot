import { render, screen } from '@testing-library/react';
import Home from '../app/page';

describe('Home page', () => {
  it('renders the heading', () => {
    render(<Home />);
    expect(screen.getByText('DZ HOOF IPTV')).toBeInTheDocument();
  });

  it('renders sign in and register links', () => {
    render(<Home />);
    expect(screen.getByText('تسجيل الدخول')).toBeInTheDocument();
    expect(screen.getByText('إنشاء حساب')).toBeInTheDocument();
  });
});
