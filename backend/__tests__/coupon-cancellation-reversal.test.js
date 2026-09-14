import { jest } from "@jest/globals";

const mockCouponUpdateOne = jest.fn();
const mockOrderFindById = jest.fn();
const mockOrderFindOneAndUpdate = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockTransactionFindOneAndUpdate = jest.fn();
const mockCheckoutGroupFindOneAndUpdate = jest.fn();
const mockCheckoutGroupUpdateOne = jest.fn();
const mockReleaseReservedStockForOrder = jest.fn();
const mockReverseOrderFinanceOnCancellation = jest.fn();
const mockClearOrderTracking = jest.fn();

const mockCouponFindOne = jest.fn();
const mockCouponFindById = jest.fn();

jest.unstable_mockModule("../app/models/coupon.js", () => ({
  default: {
    updateOne: mockCouponUpdateOne,
    findOne: mockCouponFindOne,
    findById: mockCouponFindById,
  },
}));

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: {
    findById: mockOrderFindById,
    findOneAndUpdate: mockOrderFindOneAndUpdate,
    countDocuments: mockOrderCountDocuments,
  },
}));

jest.unstable_mockModule("../app/models/transaction.js", () => ({
  default: {
    findOneAndUpdate: mockTransactionFindOneAndUpdate,
  },
}));

jest.unstable_mockModule("../app/models/checkoutGroup.js", () => ({
  default: {
    findOneAndUpdate: mockCheckoutGroupFindOneAndUpdate,
    updateOne: mockCheckoutGroupUpdateOne,
  },
}));

jest.unstable_mockModule("../app/services/stockService.js", () => ({
  releaseReservedStockForOrder: mockReleaseReservedStockForOrder,
}));

jest.unstable_mockModule("../app/services/firebaseService.js", () => ({
  clearOrderTracking: mockClearOrderTracking,
}));

jest.unstable_mockModule("../app/services/finance/orderFinanceService.js", () => ({
  reverseOrderFinanceOnCancellation: mockReverseOrderFinanceOnCancellation,
}));

const { decrementCouponUsage, computeOrderDiscount } = await import(
  "../app/services/finance/couponService.js"
);
const { compensateOrderCancellation } = await import(
  "../app/services/orderCompensation.js"
);

describe("Coupon Cancellation Reversal & Renewal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReleaseReservedStockForOrder.mockResolvedValue(true);
    mockTransactionFindOneAndUpdate.mockResolvedValue({});
    mockClearOrderTracking.mockReturnValue(Promise.resolve());
    mockReverseOrderFinanceOnCancellation.mockResolvedValue({});
  });

  describe("decrementCouponUsage", () => {
    it("returns false if no couponId is provided", async () => {
      const result = await decrementCouponUsage();
      expect(result).toBe(false);
      expect(mockCouponUpdateOne).not.toHaveBeenCalled();
    });

    it("atomically decrements usedCount guarded by floor at 0", async () => {
      mockCouponUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      const couponId = "coupon123";

      const result = await decrementCouponUsage({ couponId });

      expect(result).toBe(true);
      expect(mockCouponUpdateOne).toHaveBeenCalledWith(
        {
          _id: couponId,
          usedCount: { $gt: 0 },
        },
        { $inc: { usedCount: -1 } },
        undefined,
      );
    });

    it("returns false when coupon is already at 0 uses", async () => {
      mockCouponUpdateOne.mockResolvedValue({ modifiedCount: 0 });
      const result = await decrementCouponUsage({ couponId: "coupon123" });
      expect(result).toBe(false);
    });
  });

  describe("compensateOrderCancellation with Standalone Order", () => {
    it("decrements coupon usage and locks idempotency flag on cancellation", async () => {
      const order = {
        _id: "order123",
        orderId: "PUB123",
        coupon: "coupon123",
        financeFlags: { couponReversalApplied: false },
        save: jest.fn().mockResolvedValue(true),
      };
      mockOrderFindById.mockResolvedValue(order);
      mockOrderFindOneAndUpdate.mockResolvedValue({
        ...order,
        financeFlags: { couponReversalApplied: true },
      });
      mockCouponUpdateOne.mockResolvedValue({ modifiedCount: 1 });

      await compensateOrderCancellation(order, "PUB123");

      expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: "order123",
          "financeFlags.couponReversalApplied": { $ne: true },
        },
        {
          $set: { "financeFlags.couponReversalApplied": true },
        },
      );
      expect(mockCouponUpdateOne).toHaveBeenCalledWith(
        {
          _id: "coupon123",
          usedCount: { $gt: 0 },
        },
        { $inc: { usedCount: -1 } },
        undefined,
      );
    });

    it("is idempotent: skips coupon decrement if couponReversalApplied is already true", async () => {
      const order = {
        _id: "order123",
        orderId: "PUB123",
        coupon: "coupon123",
        financeFlags: { couponReversalApplied: true },
        save: jest.fn().mockResolvedValue(true),
      };
      mockOrderFindById.mockResolvedValue(order);

      await compensateOrderCancellation(order, "PUB123");

      expect(mockOrderFindOneAndUpdate).not.toHaveBeenCalled();
      expect(mockCouponUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe("compensateOrderCancellation with Multi-Seller Checkout Group (Option A)", () => {
    it("does not decrement coupon if other seller orders in the group are still active", async () => {
      const order = {
        _id: "order1",
        orderId: "PUB1",
        checkoutGroupId: "group123",
        coupon: "coupon123",
        save: jest.fn().mockResolvedValue(true),
      };
      mockOrderFindById.mockResolvedValue(order);
      // 1 order is still active in the checkout group
      mockOrderCountDocuments.mockResolvedValue(1);

      await compensateOrderCancellation(order, "PUB1");

      expect(mockCheckoutGroupFindOneAndUpdate).not.toHaveBeenCalled();
      expect(mockCouponUpdateOne).not.toHaveBeenCalled();
    });

    it("decrements coupon when all seller orders in the group are cancelled", async () => {
      const order = {
        _id: "order2",
        orderId: "PUB2",
        checkoutGroupId: "group123",
        coupon: "coupon123",
        save: jest.fn().mockResolvedValue(true),
      };
      mockOrderFindById.mockResolvedValue(order);
      // 0 orders active (all cancelled)
      mockOrderCountDocuments.mockResolvedValue(0);
      mockCheckoutGroupFindOneAndUpdate.mockResolvedValue({
        checkoutGroupId: "group123",
        coupon: "coupon123",
        couponReversalApplied: true,
      });
      mockCouponUpdateOne.mockResolvedValue({ modifiedCount: 1 });

      await compensateOrderCancellation(order, "PUB2");

      expect(mockCheckoutGroupFindOneAndUpdate).toHaveBeenCalledWith(
        {
          checkoutGroupId: "group123",
          couponReversalApplied: { $ne: true },
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            couponReversalApplied: true,
            status: "CANCELLED",
          }),
        }),
        { new: true },
      );
      expect(mockCouponUpdateOne).toHaveBeenCalledWith(
        {
          _id: "coupon123",
          usedCount: { $gt: 0 },
        },
        { $inc: { usedCount: -1 } },
        undefined,
      );
    });

    it("prevents duplicate rollback if another concurrent cancellation won the lock", async () => {
      const order = {
        _id: "order2",
        orderId: "PUB2",
        checkoutGroupId: "group123",
        coupon: "coupon123",
        save: jest.fn().mockResolvedValue(true),
      };
      mockOrderFindById.mockResolvedValue(order);
      mockOrderCountDocuments.mockResolvedValue(0);
      // Lock returned null because another worker already acquired it
      mockCheckoutGroupFindOneAndUpdate.mockResolvedValue(null);

      await compensateOrderCancellation(order, "PUB2");

      expect(mockCheckoutGroupUpdateOne).toHaveBeenCalledWith(
        { checkoutGroupId: "group123" },
        expect.anything(),
      );
      expect(mockCouponUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe("Customer Eligibility Renewal on Order Cancellation", () => {
    const couponDoc = {
      _id: "coupon123",
      code: "SAVE50",
      isActive: true,
      validFrom: new Date(Date.now() - 3600000),
      validTill: new Date(Date.now() + 3600000),
      usageLimit: 10,
      usedCount: 2,
      perUserLimit: 1,
      discountType: "percentage",
      discountValue: 10,
      minOrderValue: 0,
    };

    const hydratedItems = [
      {
        product: "p1",
        name: "Item 1",
        quantity: 1,
        price: 100,
        subtotal: 100,
      },
    ];

    it("blocks customer when active order already consumed perUserLimit", async () => {
      mockCouponFindOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(couponDoc),
      });
      // Active order exists: countDocuments returns 1
      mockOrderCountDocuments.mockResolvedValue(1);

      await expect(
        computeOrderDiscount({
          couponCode: "SAVE50",
          customerId: "user123",
          hydratedItems,
        }),
      ).rejects.toThrow("You have already used this coupon");

      expect(mockOrderCountDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "user123",
          coupon: "coupon123",
          status: { $nin: ["cancelled", "Cancelled", "CANCELLED"] },
          workflowStatus: { $ne: "CANCELLED" },
        }),
      );
    });

    it("allows customer to reuse coupon when previous order was cancelled", async () => {
      mockCouponFindOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(couponDoc),
      });
      // Cancelled order is excluded: countDocuments returns 0
      mockOrderCountDocuments.mockResolvedValue(0);

      const result = await computeOrderDiscount({
        couponCode: "SAVE50",
        customerId: "user123",
        hydratedItems,
      });

      expect(result).not.toBeNull();
      expect(result.discountAmount).toBe(10);
      expect(result.coupon.code).toBe("SAVE50");
    });
  });
});
