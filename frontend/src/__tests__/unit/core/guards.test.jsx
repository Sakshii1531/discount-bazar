import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockUseAuth = jest.fn();
jest.mock('@core/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import ProtectedRoute from '@core/guards/ProtectedRoute';
import RoleGuard from '@core/guards/RoleGuard';

function renderAt(path, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>customer login</div>} />
        <Route path="/admin/auth" element={<div>admin login</div>} />
        <Route path="/seller/auth" element={<div>seller login</div>} />
        <Route path="/delivery/auth" element={<div>delivery login</div>} />
        <Route path="/seller/pending-approval" element={<div>pending approval</div>} />
        <Route path="/unauthorized" element={<div>unauthorized</div>} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/seller" element={<div>seller home</div>} />
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const auth = (overrides) => ({ isAuthenticated: true, isLoading: false, user: {}, role: 'customer', ...overrides });

describe('ProtectedRoute', () => {
  it('shows a spinner while loading', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: true }));
    const { container } = renderAt('/orders', <ProtectedRoute>secret</ProtectedRoute>);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it.each([
    ['/orders', 'customer login'],
    ['/admin/dashboard', 'admin login'],
    ['/seller/products', 'seller login'],
    ['/delivery/orders', 'delivery login'],
  ])('redirects anonymous users on %s to %s', (path, target) => {
    mockUseAuth.mockReturnValue(auth({ isAuthenticated: false }));
    renderAt(path, <ProtectedRoute>secret</ProtectedRoute>);
    expect(screen.getByText(target)).toBeInTheDocument();
  });

  it('renders children for authenticated customers', () => {
    mockUseAuth.mockReturnValue(auth());
    renderAt('/orders', <ProtectedRoute>secret</ProtectedRoute>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('sends unapproved sellers to pending approval', () => {
    mockUseAuth.mockReturnValue(auth({ role: 'seller', user: { isVerified: false, isActive: true } }));
    renderAt('/seller/products', <ProtectedRoute>secret</ProtectedRoute>);
    expect(screen.getByText('pending approval')).toBeInTheDocument();
  });

  it('lets approved sellers in', () => {
    mockUseAuth.mockReturnValue(
      auth({ role: 'seller', user: { isVerified: true, isActive: true, applicationStatus: 'approved' } }),
    );
    renderAt('/seller/products', <ProtectedRoute>secret</ProtectedRoute>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('blocks deactivated sellers', () => {
    mockUseAuth.mockReturnValue(auth({ role: 'seller', user: { isVerified: true, isActive: false } }));
    renderAt('/seller/products', <ProtectedRoute>secret</ProtectedRoute>);
    expect(screen.getByText('pending approval')).toBeInTheDocument();
  });

  it('sends unverified riders back to delivery auth', () => {
    mockUseAuth.mockReturnValue(auth({ role: 'delivery', user: { isVerified: false } }));
    renderAt('/delivery/orders', <ProtectedRoute>secret</ProtectedRoute>);
    expect(screen.getByText('delivery login')).toBeInTheDocument();
  });

  it('lets verified riders in', () => {
    mockUseAuth.mockReturnValue(auth({ role: 'delivery', user: { isVerified: true } }));
    renderAt('/delivery/orders', <ProtectedRoute>secret</ProtectedRoute>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
});

describe('RoleGuard', () => {
  it('renders nothing while loading', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: true }));
    const { container } = renderAt('/admin', <RoleGuard allowedRoles={['admin']}>admin area</RoleGuard>);
    expect(container).toBeEmptyDOMElement();
  });

  it('allows matching roles', () => {
    mockUseAuth.mockReturnValue(auth({ role: 'admin' }));
    renderAt('/admin', <RoleGuard allowedRoles={['admin']}>admin area</RoleGuard>);
    expect(screen.getByText('admin area')).toBeInTheDocument();
  });

  it('bounces a logged-in customer to the storefront', () => {
    mockUseAuth.mockReturnValue(auth({ role: 'customer' }));
    renderAt('/admin', <RoleGuard allowedRoles={['admin']}>admin area</RoleGuard>);
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('bounces a logged-in seller to the seller panel', () => {
    mockUseAuth.mockReturnValue(auth({ role: 'seller' }));
    renderAt('/admin', <RoleGuard allowedRoles={['admin']}>admin area</RoleGuard>);
    expect(screen.getByText('seller home')).toBeInTheDocument();
  });

  it('sends anonymous users to /unauthorized', () => {
    mockUseAuth.mockReturnValue(auth({ isAuthenticated: false, role: null }));
    renderAt('/admin', <RoleGuard allowedRoles={['admin']}>admin area</RoleGuard>);
    expect(screen.getByText('unauthorized')).toBeInTheDocument();
  });
});
