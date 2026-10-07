import { jest } from "@jest/globals";

// Keep this a pure unit test: settings are passed in, never loaded from the DB.
jest.unstable_mockModule("../../../app/services/finance/financeSettingsService.js", () => ({
  getOrCreateFinanceSettings: jest.fn(async () => ({})),
}));

const {
  toDeliveryFee,
  toDeliveryMinutes,
  getGlobalDeliveryFee,
  formatDeliveryTime,
  quoteProductDelivery,
  quoteCartProductDelivery,
  quoteCartDelivery,
  decorateProductsWithDelivery,
} = await import("../../../app/services/deliveryQuoteService.js");

const fixed = (fee, minutes, extra = {}) => ({
  deliveryPricingMode: "fixed_price",
  fixedDeliveryFee: fee,
  globalDeliveryTimeMinutes: minutes,
  ...extra,
});

describe("delivery value cleaning", () => {
  it("never returns negative or invalid values", () => {
    expect(toDeliveryFee(-5)).toBe(0);
    expect(toDeliveryFee("abc")).toBe(0);
    expect(toDeliveryFee("12.345")).toBe(12.35);
    expect(toDeliveryMinutes(-1)).toBe(0);
    expect(toDeliveryMinutes(14.6)).toBe(15);
    expect(toDeliveryMinutes(undefined)).toBe(0);
  });

  it("uses the fixed fee in fixed mode and the base fee in distance mode", () => {
    expect(getGlobalDeliveryFee(fixed(10, 0))).toBe(10);
    expect(getGlobalDeliveryFee({ deliveryPricingMode: "distance_based", customerBaseDeliveryFee: 25 })).toBe(25);
  });
});

describe("quoteProductDelivery (global + product)", () => {
  it("adds global and product values (spec example: ₹10+₹20, 15+20 mins)", () => {
    expect(quoteProductDelivery({ productDeliveryFee: 20, productDeliveryTimeMinutes: 20 }, fixed(10, 15))).toEqual({
      finalDeliveryFee: 30,
      isFreeDelivery: false,
      finalDeliveryTimeMinutes: 35,
      deliveryTime: "35 mins",
    });
  });

  it("uses only the non-zero side when the other is 0", () => {
    expect(quoteProductDelivery({ productDeliveryFee: 0, productDeliveryTimeMinutes: 0 }, fixed(10, 15)).finalDeliveryFee).toBe(10);
    const onlyProduct = quoteProductDelivery({ productDeliveryFee: 20, productDeliveryTimeMinutes: 20 }, fixed(0, 0));
    expect(onlyProduct.finalDeliveryFee).toBe(20);
    expect(onlyProduct.deliveryTime).toBe("20 mins");
  });

  it("treats a total fee of 0 as free delivery", () => {
    expect(quoteProductDelivery({}, fixed(0, 10)).isFreeDelivery).toBe(true);
  });

  it("shows the admin message when the total time is 0", () => {
    expect(quoteProductDelivery({}, fixed(0, 0)).deliveryTime).toBe("Instant Delivery");
    expect(quoteProductDelivery({}, fixed(0, 0, { zeroDeliveryTimeMessage: "Same Day Delivery" })).deliveryTime).toBe(
      "Same Day Delivery",
    );
    expect(formatDeliveryTime(0, { zeroDeliveryTimeMessage: "   " })).toBe("Instant Delivery");
  });

  it("ignores negative product values instead of subtracting", () => {
    const q = quoteProductDelivery({ productDeliveryFee: -50, productDeliveryTimeMinutes: -10 }, fixed(10, 15));
    expect(q.finalDeliveryFee).toBe(10);
    expect(q.finalDeliveryTimeMinutes).toBe(15);
  });
});

describe("cart rules", () => {
  it("3 products ₹20/₹30/₹40 and 10/20/30 mins → ₹10 + ₹40 and 15 + 30 mins", () => {
    const part = quoteCartProductDelivery(
      [
        { productId: "a", productDeliveryFee: 20, productDeliveryTimeMinutes: 10 },
        { productId: "b", productDeliveryFee: 30, productDeliveryTimeMinutes: 20 },
        { productId: "c", productDeliveryFee: 40, productDeliveryTimeMinutes: 30 },
      ],
      fixed(10, 15),
    );
    expect(10 + part.productDeliveryFeeTotal).toBe(50);
    expect(part.deliveryTimeMinutes).toBe(45);
  });

  it("takes the highest product fee and the slowest time", () => {
    const part = quoteCartProductDelivery(
      [
        { productId: "a", productDeliveryFee: 20, productDeliveryTimeMinutes: 20 },
        { productId: "a", productDeliveryFee: 20, productDeliveryTimeMinutes: 20 }, // same product, other variant
        { productId: "b", productDeliveryFee: 5, productDeliveryTimeMinutes: 45 },
      ],
      fixed(10, 15),
    );
    expect(part.productDeliveryFeeTotal).toBe(20);
    expect(part.deliveryTimeMinutes).toBe(60);
    expect(part.deliveryTimeLabel).toBe("60 mins");
  });

  it("charges the global fee per seller and uses the slowest seller for ETA", () => {
    const q = quoteCartDelivery(
      [
        { _id: "a", sellerId: "s1", productDeliveryFee: 20, productDeliveryTimeMinutes: 20 },
        { _id: "b", sellerId: "s2", productDeliveryFee: 0, productDeliveryTimeMinutes: 40 },
      ],
      fixed(10, 15),
    );
    expect(q.sellers).toHaveLength(2);
    expect(q.sellers.find((s) => s.sellerId === "s1").deliveryFee).toBe(30);
    expect(q.sellers.find((s) => s.sellerId === "s2").deliveryFee).toBe(10);
    expect(q.deliveryFee).toBe(40);
    expect(q.deliveryTimeMinutes).toBe(55);
    expect(q.estimated).toBe(false);
  });

  it("is free and instant when everything is 0, and flags distance mode as estimated", () => {
    const free = quoteCartDelivery([{ _id: "a", sellerId: "s1" }], fixed(0, 0));
    expect(free.isFreeDelivery).toBe(true);
    expect(free.deliveryTime).toBe("Instant Delivery");
    expect(quoteCartDelivery([], { deliveryPricingMode: "distance_based" }).estimated).toBe(true);
  });
});

describe("decorateProductsWithDelivery", () => {
  it("adds final values without dropping product fields", async () => {
    const [p] = await decorateProductsWithDelivery(
      [{ _id: "x", name: "Tea", productDeliveryFee: 20, productDeliveryTimeMinutes: 20 }],
      fixed(10, 15),
    );
    expect(p).toMatchObject({ name: "Tea", finalDeliveryFee: 30, deliveryTime: "35 mins" });
  });
});
