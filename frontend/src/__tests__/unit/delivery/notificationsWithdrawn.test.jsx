import React from 'react';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let withdrawnHandler;
jest.mock('@/core/services/orderSocket', () => ({
  getOrderSocket: jest.fn(),
  onDeliveryBroadcastWithdrawn: jest.fn((_getToken, handler) => {
    withdrawnHandler = handler;
    return () => {};
  }),
  onNotificationNew: jest.fn(() => () => {}),
}));
jest.mock('@/modules/delivery/services/deliveryApi', () => ({
  deliveryApi: {
    getNotifications: jest.fn(() =>
      Promise.resolve({ data: { success: true, result: { notifications: [] } } }),
    ),
  },
}));
jest.mock('@core/context/AuthContext', () => ({ useAuth: () => ({ user: { _id: 'rider-me' } }) }));
jest.mock('sonner', () => ({ toast: { info: jest.fn(), error: jest.fn(), success: jest.fn() } }));

import { toast } from 'sonner';
import Notifications from '@/modules/delivery/pages/Notifications';

const TAKEN = 'An order request was accepted by another partner.';

describe('rider Notifications: withdrawn order request', () => {
  beforeEach(async () => {
    await act(async () => {
      render(<MemoryRouter><Notifications /></MemoryRouter>);
    });
  });

  it('says another partner took it only when someone else won', () => {
    act(() => withdrawnHandler({ orderId: 'O1', winnerDeliveryId: 'rider-other' }));
    expect(toast.info).toHaveBeenCalledWith(TAKEN);
  });

  it.each([
    ['this rider accepted it (another device)', { orderId: 'O1', winnerDeliveryId: 'rider-me' }],
    ['this rider skipped it', { orderId: 'O1', reason: 'skipped', closedByDeliveryId: 'rider-me' }],
    ['the order was cancelled', { orderId: 'O1', winnerDeliveryId: null }],
  ])('stays quiet when %s', (_label, payload) => {
    act(() => withdrawnHandler(payload));
    expect(toast.info).not.toHaveBeenCalledWith(TAKEN);
  });
});
