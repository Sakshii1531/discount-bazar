import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import useOrderBill from '@/modules/seller/components/orders/useOrderBill';
import { sellerApi } from '@/modules/seller/services/sellerApi';
import { toast } from 'sonner';

jest.mock('@core/context/AuthContext', () => ({
  useAuth: () => ({ user: { shopName: 'Profile Shop', phone: '9000000000', gstNumber: '27ABCDE1234F1Z5' } }),
}));
jest.mock('@/modules/seller/services/sellerApi', () => ({
  sellerApi: { getOrderDetails: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('qrcode', () => ({ toDataURL: () => Promise.resolve('') }));

const onlineOrder = {
  orderId: 'ORD-AB12CD34',
  orderSource: 'APP',
  status: 'confirmed',
  createdAt: '2026-11-10T10:00:00.000Z',
  paymentMode: 'COD',
  paymentStatus: 'PENDING',
  seller: { shopName: 'Discount Bazar Store', address: 'MG Road', city: 'Pune' },
  address: { name: 'Riya', phone: '9876543210', address: 'Flat 4', city: 'Pune' },
  items: [{ name: 'Rice 1kg', quantity: 2, price: 50, mrp: 60 }],
  paymentBreakdown: { productSubtotal: 100, deliveryFeeCharged: 20, grandTotal: 120 },
};

function Harness({ orderId = 'ORD-AB12CD34' }) {
  const { openBill, billModal } = useOrderBill();
  return (
    <div>
      <button onClick={() => openBill(orderId)}>open</button>
      {billModal}
    </div>
  );
}

describe('seller online order bill', () => {
  it('loads the order and shows a tax invoice with the store header, customer and charges', async () => {
    sellerApi.getOrderDetails.mockResolvedValue({ data: { result: onlineOrder } });
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));

    expect(await screen.findByText('Tax Invoice')).toBeInTheDocument();
    expect(sellerApi.getOrderDetails).toHaveBeenCalledWith('ORD-AB12CD34');
    expect(screen.getByText('Discount Bazar Store')).toBeInTheDocument();
    expect(screen.getByText(/MG Road, Pune/)).toBeInTheDocument();
    // GSTIN comes from the seller profile when the order's seller record lacks it.
    expect(screen.getByText('27ABCDE1234F1Z5')).toBeInTheDocument();
    expect(screen.getByText(/Bill No :ORD-AB12CD34/)).toBeInTheDocument();
    expect(screen.getByText(/Customer Name : Riya/)).toBeInTheDocument();
    expect(screen.getByText('Delivery Fee')).toBeInTheDocument();
    // COD not yet collected → still due.
    expect(screen.getByText('Total Due').nextSibling).toHaveTextContent('120');
    expect(screen.getByText('Print Bill')).toBeInTheDocument();
  });

  it('closes the bill', async () => {
    sellerApi.getOrderDetails.mockResolvedValue({ data: { result: onlineOrder } });
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    await screen.findByText('Tax Invoice');
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByText('Tax Invoice')).not.toBeInTheDocument();
  });

  it('shows an error and no bill when the order cannot be loaded', async () => {
    sellerApi.getOrderDetails.mockRejectedValue({ response: { data: { message: 'Access denied' } } });
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Access denied'));
    expect(screen.queryByText('Tax Invoice')).not.toBeInTheDocument();
  });

  it('does not open a bill for an order without items (checkout group summary)', async () => {
    sellerApi.getOrderDetails.mockResolvedValue({ data: { result: { orderId: 'CHK-1', isGroupSummary: true, items: [] } } });
    render(<Harness orderId="CHK-1" />);
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Bill is not available for this order'));
    expect(screen.queryByText('Tax Invoice')).not.toBeInTheDocument();
  });
});
