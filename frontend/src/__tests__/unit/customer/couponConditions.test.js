import { couponConditions } from '@modules/customer/pages/checkout/components/CheckoutCouponSection';

describe('couponConditions (customer coupon card)', () => {
  it('shows the VIP monthly spend, not just the extra minimum', () => {
    expect(
      couponConditions({ couponType: 'monthly_volume', monthlyVolumeThreshold: 10000, minOrderValue: 500, discountType: 'percentage', maxDiscount: 1000 })
    ).toEqual([
      'For customers who spent ₹10,000 this month',
      'On orders of ₹500 or more',
      'Max discount ₹1,000',
    ]);
  });

  it('shows bulk item count and category names', () => {
    expect(couponConditions({ couponType: 'bulk_order', minItems: 40, discountType: 'fixed' })).toEqual(['Add 40+ items to the cart']);
    expect(
      couponConditions({ couponType: 'category_based', applicableCategories: [{ name: 'Grocery' }, { name: 'Dairy' }], discountType: 'fixed' })
    ).toEqual(['On products from Grocery, Dairy']);
  });

  it('a plain coupon has no conditions', () => {
    expect(couponConditions({ couponType: 'generic', discountType: 'fixed', minOrderValue: 0 })).toEqual([]);
  });
});
