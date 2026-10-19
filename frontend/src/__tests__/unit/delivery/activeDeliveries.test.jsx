import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { makeJwt } from '../../../../test-utils/jwt';

jest.mock('@modules/delivery/services/deliveryApi', () => ({
  deliveryApi: { getActiveOrders: jest.fn(), getOrderDetails: jest.fn() },
}));
jest.mock('@core/services/orderSocket', () => ({
  onSocketEvent: jest.fn(() => () => {}),
  onSocketConnect: jest.fn(() => () => {}),
}));
jest.mock('sonner', () => ({ toast: { info: jest.fn(), error: jest.fn(), success: jest.fn() } }));

import { deliveryApi } from '@modules/delivery/services/deliveryApi';
import { toast } from 'sonner';
import { ActiveDeliveriesProvider } from '@modules/delivery/context/ActiveDeliveriesContext';
import ActiveDeliveriesSection from '@modules/delivery/components/ActiveDeliveriesSection';

const RIDER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const activeOrder = (over = {}) => ({
  orderId: 'ORD1',
  kind: 'delivery',
  stage: 'HEADING_TO_STORE',
  store: { name: 'Main Mart', address: '1 Market St' },
  customer: { name: 'Asha', address: '12 MG Road, Indore' },
  resumePath: '/delivery/order-details/ORD1',
  ...over,
});
const ok = (orders, extra = {}) =>
  Promise.resolve({ data: { result: { orders, canAcceptMore: true, maxActiveOrders: 0, ...extra } } });

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/delivery/dashboard']}>
      <ActiveDeliveriesProvider>
        <Routes>
          <Route path="/delivery/dashboard" element={<><ActiveDeliveriesSection /><Where /></>} />
          <Route path="/delivery/order-details/:id" element={<Where />} />
        </Routes>
      </ActiveDeliveriesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth_delivery', makeJwt({ id: RIDER, role: 'delivery' }));
});

describe('active delivery card', () => {
  it('shows a checking state (never "no active order") until the server answers', async () => {
    let resolve;
    deliveryApi.getActiveOrders.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderDashboard();
    expect(screen.getByText(/checking for active deliveries/i)).toBeInTheDocument();
    await act(async () => resolve({ data: { result: { orders: [activeOrder()], canAcceptMore: true } } }));
    expect(await screen.findByText('#ORD1')).toBeInTheDocument();
    expect(screen.getByText(/active delivery in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/pick up from: main mart/i)).toBeInTheDocument();
    expect(screen.getByText(/deliver to: asha/i)).toBeInTheDocument();
  });

  it('lists every active order separately', async () => {
    deliveryApi.getActiveOrders.mockReturnValue(
      ok([activeOrder(), activeOrder({ orderId: 'ORD2', stage: 'HEADING_TO_CUSTOMER', store: null })]),
    );
    renderDashboard();
    expect(await screen.findByText('2 active deliveries')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /resume delivery/i })).toHaveLength(2);
  });

  it('renders nothing when the rider has no active work', async () => {
    deliveryApi.getActiveOrders.mockReturnValue(ok([]));
    renderDashboard();
    await waitFor(() => expect(screen.queryByText(/checking/i)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
  });
});

describe('Resume Delivery', () => {
  it('re-verifies with the server, then opens the existing order once despite repeated taps', async () => {
    deliveryApi.getActiveOrders.mockReturnValue(ok([activeOrder()]));
    let resolveDetails;
    deliveryApi.getOrderDetails.mockReturnValue(new Promise((r) => { resolveDetails = r; }));
    renderDashboard();
    const button = await screen.findByRole('button', { name: /resume delivery/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () =>
      resolveDetails({ data: { result: { orderId: 'ORD1', workflowStatus: 'PICKUP_READY', deliveryBoy: { _id: RIDER } } } }),
    );
    expect(deliveryApi.getOrderDetails).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/delivery/order-details/ORD1');
  });

  it('shows the final state instead of reopening a cancelled order', async () => {
    deliveryApi.getActiveOrders.mockReturnValueOnce(ok([activeOrder()])).mockReturnValue(ok([]));
    deliveryApi.getOrderDetails.mockResolvedValue({
      data: { result: { orderId: 'ORD1', workflowStatus: 'CANCELLED', status: 'cancelled', deliveryBoy: { _id: RIDER } } },
    });
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: /resume delivery/i }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Order #ORD1 was cancelled.'));
    expect(screen.getByTestId('where')).toHaveTextContent('/delivery/dashboard');
    await waitFor(() => expect(screen.queryByText('#ORD1')).not.toBeInTheDocument());
  });

  it('does not reopen an order that was reassigned to another rider', async () => {
    deliveryApi.getActiveOrders.mockReturnValueOnce(ok([activeOrder()])).mockReturnValue(ok([]));
    deliveryApi.getOrderDetails.mockResolvedValue({
      data: { result: { orderId: 'ORD1', workflowStatus: 'DELIVERY_ASSIGNED', deliveryBoy: { _id: OTHER } } },
    });
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: /resume delivery/i }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Order #ORD1 is no longer assigned to you.'));
    expect(screen.getByTestId('where')).toHaveTextContent('/delivery/dashboard');
  });

  it('stays put when the server cannot be reached', async () => {
    deliveryApi.getActiveOrders.mockReturnValue(ok([activeOrder()]));
    deliveryApi.getOrderDetails.mockRejectedValue(new Error('Network Error'));
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: /resume delivery/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId('where')).toHaveTextContent('/delivery/dashboard');
  });
});

describe('offline / relaunch', () => {
  it('shows the last known active order as provisional while the server is unreachable', async () => {
    localStorage.setItem(
      'delivery_active_orders_snapshot',
      JSON.stringify({ riderId: RIDER, orders: [activeOrder()], canAcceptMore: true, syncedAt: '2026-10-19T10:00:00Z' }),
    );
    deliveryApi.getActiveOrders.mockRejectedValue(new Error('Network Error'));
    renderDashboard();
    expect(screen.getByText('#ORD1')).toBeInTheDocument();
    expect(await screen.findByText(/last known status/i)).toBeInTheDocument();
  });

  it("never shows another rider's cached work", async () => {
    localStorage.setItem(
      'delivery_active_orders_snapshot',
      JSON.stringify({ riderId: OTHER, orders: [activeOrder()] }),
    );
    deliveryApi.getActiveOrders.mockRejectedValue(new Error('Network Error'));
    renderDashboard();
    expect(screen.queryByText('#ORD1')).not.toBeInTheDocument();
  });

  it('replaces the cached list with the server answer once it arrives', async () => {
    localStorage.setItem(
      'delivery_active_orders_snapshot',
      JSON.stringify({ riderId: RIDER, orders: [activeOrder()] }),
    );
    deliveryApi.getActiveOrders.mockReturnValue(ok([])); // completed while the app was closed
    renderDashboard();
    await waitFor(() => expect(screen.queryByText('#ORD1')).not.toBeInTheDocument());
    expect(localStorage.getItem('delivery_active_orders_snapshot')).toBeNull();
  });
});

import { restoreTarget } from '@modules/delivery/utils/activeDeliveryRestore';

describe('launch / foreground restore decision', () => {
  const one = [activeOrder({ stage: 'AT_CUSTOMER' })];
  it.each([
    ['dashboard, one active order', { path: '/delivery/dashboard', orders: one }, '/delivery/order-details/ORD1'],
    ['bare /delivery root', { path: '/delivery', orders: one }, '/delivery/order-details/ORD1'],
    ['still on splash', { path: '/delivery/splash', orders: one }, 'wait'],
    ['no active work', { path: '/delivery/dashboard', orders: [] }, null],
    ['several orders — rider chooses', { path: '/delivery/dashboard', orders: [...one, activeOrder({ orderId: 'ORD2' })] }, null],
    ['rider is on another tab on purpose', { path: '/delivery/earnings', orders: one }, null],
    ['an incoming offer is on screen', { path: '/delivery/dashboard', orders: one, incomingOfferOpen: true }, null],
  ])('%s', (_label, input, expected) => {
    expect(restoreTarget(input)).toBe(expected);
  });
});
