import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@modules/delivery/services/deliveryApi', () => ({
  deliveryApi: { getEarnings: jest.fn(), getCodCashSummary: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { info: jest.fn(), error: jest.fn(), success: jest.fn() } }));
// recharts needs real layout measurements that jsdom does not provide.
jest.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return { BarChart: Stub, Bar: Stub, XAxis: Stub, Tooltip: Stub, ResponsiveContainer: Stub, CartesianGrid: Stub };
});

import { deliveryApi } from '@modules/delivery/services/deliveryApi';
import Earnings from '@modules/delivery/pages/Earnings';

const earnings = {
  data: { success: true, result: { totalEarnings: 1200, chartData: [], transactions: [] } },
};

describe('delivery earnings page', () => {
  it('renders the COD cash card from the COD summary', async () => {
    deliveryApi.getEarnings.mockResolvedValue(earnings);
    deliveryApi.getCodCashSummary.mockResolvedValue({
      data: {
        success: true,
        result: {
          systemFloatCOD: 450,
          cashInHand: 500,
          toCollect: [],
          toRemit: [{ orderId: 'ORD9', amountNetPending: 450 }],
        },
      },
    });

    render(<Earnings />);

    expect(await screen.findByText('COD Cash Management')).toBeInTheDocument();
    expect(screen.getByText('Order #ORD9')).toBeInTheDocument();
  });

  it('still renders earnings when the COD summary fails', async () => {
    deliveryApi.getEarnings.mockResolvedValue(earnings);
    deliveryApi.getCodCashSummary.mockRejectedValue(new Error('offline'));

    render(<Earnings />);

    expect(await screen.findByText('No COD cash pending.')).toBeInTheDocument();
  });
});
