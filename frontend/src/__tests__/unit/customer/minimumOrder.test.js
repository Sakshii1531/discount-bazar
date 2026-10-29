import { getMinimumOrderStatus, minimumOrderMessage } from '@modules/customer/utils/minimumOrder';

const item = (price, quantity = 1, extra = {}) => ({ id: `p${price}`, price, quantity, ...extra });

describe('getMinimumOrderStatus (cart / checkout minimum order)', () => {
  it.each([
    [20, 79],
    [50, 49],
    [65, 34],
    [80, 19],
    [95, 4],
  ])('a ₹%i cart needs ₹%i more', (subtotal, remaining) => {
    const status = getMinimumOrderStatus({ cart: [item(subtotal)], minOrderValue: 99 });
    expect(status).toEqual({ minOrderValue: 99, eligibleSubtotal: subtotal, remainingAmount: remaining, isMet: false });
    expect(minimumOrderMessage(status.remainingAmount)).toBe(`Add ₹${remaining} more to place your order.`);
  });

  it('is met exactly at the minimum (₹95 + ₹4)', () => {
    expect(getMinimumOrderStatus({ cart: [item(95), item(4)], minOrderValue: 99 })).toMatchObject({ remainingAmount: 0, isMet: true });
  });

  it('uses the sale price and the quantity', () => {
    const status = getMinimumOrderStatus({ cart: [item(60, 2, { salePrice: 45 })], minOrderValue: 99 });
    expect(status).toMatchObject({ eligibleSubtotal: 90, remainingAmount: 9 });
  });

  it('a coupon discount lowers the eligible value unless the admin excludes it', () => {
    const cart = [item(110)];
    expect(getMinimumOrderStatus({ cart, minOrderValue: 99, couponDiscount: 20 })).toMatchObject({ eligibleSubtotal: 90, remainingAmount: 9 });
    expect(getMinimumOrderStatus({ cart, minOrderValue: 99, couponDiscount: 20, includeCouponDiscount: false }).isMet).toBe(true);
  });

  it('out of stock items do not count', () => {
    const cart = [item(60), item(50, 1, { id: 'gone' })];
    const status = getMinimumOrderStatus({ cart, minOrderValue: 99, isItemOutOfStock: (i) => i.id === 'gone' });
    expect(status).toMatchObject({ eligibleSubtotal: 60, remainingAmount: 39 });
  });

  it('rounds a part-rupee shortfall up in the message', () => {
    expect(minimumOrderMessage(78.5)).toBe('Add ₹79 more to place your order.');
  });

  it('does nothing until the minimum is known or when it is 0', () => {
    expect(getMinimumOrderStatus({ cart: [item(10)], minOrderValue: undefined })).toBeNull();
    expect(getMinimumOrderStatus({ cart: [item(10)], minOrderValue: 0 })).toBeNull();
  });
});
