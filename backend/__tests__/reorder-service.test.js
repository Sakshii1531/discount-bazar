import { jest } from "@jest/globals";

const mockOrderFindOne = jest.fn();
const mockSellerFindById = jest.fn();
const mockCartFindOne = jest.fn();
const mockCartFindById = jest.fn();
const mockProductFind = jest.fn();
const mockProductFindById = jest.fn();
const mockCartSave = jest.fn().mockResolvedValue(true);

const mockOrderModel = {
  findOne: mockOrderFindOne,
};

const mockSellerModel = {
  findById: mockSellerFindById,
};

class MockCart {
  constructor(doc = {}) {
    this._id = doc._id || "mock-cart-id";
    this.customerId = doc.customerId;
    this.items = doc.items ? [...doc.items] : [];
    this.markModified = jest.fn();
    this.save = mockCartSave;
  }
  static findOne = mockCartFindOne;
  static findById = mockCartFindById;
}

const mockProductModel = {
  find: mockProductFind,
  findById: mockProductFindById,
};

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: mockOrderModel,
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: mockSellerModel,
}));

jest.unstable_mockModule("../app/models/cart.js", () => ({
  default: MockCart,
}));

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: mockProductModel,
}));

const { reorderOrder } = await import("../app/services/reorderService.js");

describe("reorderService Unit Tests", () => {
  const customerId = "user-123";
  const sellerId = "seller-456";
  const orderId = "ORD-2026-TEST";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("1. Rejects unauthenticated caller with 401", async () => {
    await expect(
      reorderOrder({ orderId, customerId: null }),
    ).rejects.toMatchObject({ statusCode: 401, message: "Unauthorized" });
  });

  it("2. Returns 404 if order does not exist or customer is not the owner (IDOR safe)", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      reorderOrder({ orderId, customerId }),
    ).rejects.toMatchObject({ statusCode: 404, message: "Order not found" });

    expect(mockOrderFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ customer: customerId }),
    );
  });

  it("3. Returns 400 if historical order seller is inactive", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [{ product: "p-1", quantity: 2 }],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: false,
          shopName: "Closed Store",
        }),
      }),
    });

    await expect(
      reorderOrder({ orderId, customerId }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("currently unavailable"),
    });
  });

  it("4. Returns 409 SELLER_CONFLICT if active cart has items from a different seller", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [{ product: "p-1", quantity: 2 }],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: true,
          applicationStatus: "approved",
          shopName: "Target Store",
        }),
      }),
    });

    // Existing cart contains an item from seller-999
    const existingCart = new MockCart({
      customerId,
      items: [{ productId: "p-other", quantity: 1 }],
    });
    mockCartFindOne.mockResolvedValue(existingCart);

    mockProductFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "p-other",
          sellerId: "seller-999",
        }),
      }),
    });

    await expect(
      reorderOrder({ orderId, customerId, clearExisting: false }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "SELLER_CONFLICT",
      details: expect.objectContaining({
        code: "SELLER_CONFLICT",
        cartSellerId: "seller-999",
        orderSellerId: sellerId,
      }),
    });
  });

  it("5. Replaces cart if clearExisting: true even when previous cart had another seller", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [{ product: "p-1", quantity: 2 }],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: true,
          applicationStatus: "approved",
          shopName: "Target Store",
        }),
      }),
    });

    const existingCart = new MockCart({
      customerId,
      items: [{ productId: "p-other", quantity: 1 }],
    });
    mockCartFindOne.mockResolvedValue(existingCart);

    mockProductFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: "p-1",
          name: "Fresh Bread",
          sellerId,
          stock: 10,
          status: "active",
          price: 40,
          salePrice: 35,
        },
      ]),
    });

    mockCartFindById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: existingCart._id,
          customerId,
          items: [
            {
              productId: { _id: "p-1", name: "Fresh Bread", price: 40, salePrice: 35 },
              quantity: 2,
              variantSku: "",
            },
          ],
        }),
      }),
    });

    const result = await reorderOrder({
      orderId,
      customerId,
      clearExisting: true,
    });

    expect(result.summary.addedItemCount).toBe(1);
    expect(result.summary.addedItems[0].name).toBe("Fresh Bread");
    expect(existingCart.items).toHaveLength(1);
    expect(existingCart.items[0].productId).toBe("p-1");
    expect(existingCart.items[0].quantity).toBe(2);
    expect(mockCartSave).toHaveBeenCalled();
  });

  it("6. Merges items additively into existing cart when sellers match", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [{ product: "p-1", quantity: 2 }],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: true,
          applicationStatus: "approved",
          shopName: "Target Store",
        }),
      }),
    });

    const existingCart = new MockCart({
      customerId,
      items: [{ productId: "p-1", variantSku: "", quantity: 1 }],
    });
    mockCartFindOne.mockResolvedValue(existingCart);

    mockProductFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "p-1",
          sellerId: sellerId,
        }),
      }),
    });

    mockProductFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: "p-1",
          name: "Fresh Bread",
          sellerId,
          stock: 10,
          status: "active",
        },
      ]),
    });

    mockCartFindById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: existingCart._id,
          customerId,
          items: [{ productId: { _id: "p-1" }, quantity: 3, variantSku: "" }],
        }),
      }),
    });

    const result = await reorderOrder({
      orderId,
      customerId,
      clearExisting: false,
    });

    expect(result.summary.addedItemCount).toBe(1);
    expect(existingCart.items[0].quantity).toBe(3); // 1 existing + 2 reordered
  });

  it("7. Filters out inactive or unapproved products and reports in unavailableItems", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [
          { product: "p-active", quantity: 1 },
          { product: "p-inactive", quantity: 1 },
        ],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: true,
          applicationStatus: "approved",
          shopName: "Target Store",
        }),
      }),
    });

    const existingCart = new MockCart({ customerId, items: [] });
    mockCartFindOne.mockResolvedValue(existingCart);

    // Only p-active returned by query
    mockProductFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: "p-active",
          name: "Active Milk",
          sellerId,
          stock: 5,
          status: "active",
        },
      ]),
    });

    mockCartFindById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: existingCart._id,
          customerId,
          items: [{ productId: { _id: "p-active" }, quantity: 1, variantSku: "" }],
        }),
      }),
    });

    const result = await reorderOrder({ orderId, customerId });

    expect(result.summary.addedItemCount).toBe(1);
    expect(result.summary.unavailableItems).toHaveLength(1);
    expect(result.summary.unavailableItems[0].productId).toBe("p-inactive");
    expect(result.summary.unavailableItems[0].reason).toBe("PRODUCT_UNAVAILABLE");
  });

  it("8. Filters out items with zero stock", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [{ product: "p-out", quantity: 2 }],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: true,
          applicationStatus: "approved",
        }),
      }),
    });

    const existingCart = new MockCart({ customerId, items: [] });
    mockCartFindOne.mockResolvedValue(existingCart);

    mockProductFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: "p-out",
          name: "Out of Stock Cheese",
          sellerId,
          stock: 0,
          status: "active",
        },
      ]),
    });

    mockCartFindById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(existingCart),
      }),
    });

    const result = await reorderOrder({ orderId, customerId });

    expect(result.summary.addedItemCount).toBe(0);
    expect(result.summary.unavailableItems).toHaveLength(1);
    expect(result.summary.unavailableItems[0].reason).toBe("OUT_OF_STOCK");
    expect(existingCart.items).toHaveLength(0);
  });

  it("9. Adjusts quantity when current stock is less than requested quantity", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [{ product: "p-limited", quantity: 5 }],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: true,
          applicationStatus: "approved",
        }),
      }),
    });

    const existingCart = new MockCart({ customerId, items: [] });
    mockCartFindOne.mockResolvedValue(existingCart);

    mockProductFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: "p-limited",
          name: "Limited Biscuits",
          sellerId,
          stock: 2, // only 2 in stock
          status: "active",
        },
      ]),
    });

    mockCartFindById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: existingCart._id,
          customerId,
          items: [{ productId: { _id: "p-limited" }, quantity: 2, variantSku: "" }],
        }),
      }),
    });

    const result = await reorderOrder({ orderId, customerId });

    expect(result.summary.addedItemCount).toBe(1);
    expect(result.summary.adjustedItems).toHaveLength(1);
    expect(result.summary.adjustedItems[0].requestedQuantity).toBe(5);
    expect(result.summary.adjustedItems[0].addedQuantity).toBe(2);
    expect(existingCart.items[0].quantity).toBe(2);
  });

  it("10. Enforces exact variant SKU matching and rejects nonexistent variant", async () => {
    mockOrderFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "order-obj-id",
        orderId,
        customer: customerId,
        seller: sellerId,
        items: [{ product: "p-var", variantSlot: "SKU-OLD-DELETED", quantity: 1 }],
      }),
    });

    mockSellerFindById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: sellerId,
          isActive: true,
          applicationStatus: "approved",
        }),
      }),
    });

    const existingCart = new MockCart({ customerId, items: [] });
    mockCartFindOne.mockResolvedValue(existingCart);

    // Product has variants, but not SKU-OLD-DELETED
    mockProductFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: "p-var",
          name: "Variant Product",
          sellerId,
          stock: 10,
          status: "active",
          variants: [
            { sku: "SKU-OTHER-1", name: "100g", stock: 5 },
            { sku: "SKU-OTHER-2", name: "200g", stock: 5 },
          ],
        },
      ]),
    });

    mockCartFindById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(existingCart),
      }),
    });

    const result = await reorderOrder({ orderId, customerId });

    expect(result.summary.addedItemCount).toBe(0);
    expect(result.summary.unavailableItems).toHaveLength(1);
    expect(result.summary.unavailableItems[0].reason).toBe("VARIANT_UNAVAILABLE");
  });
});
