import {
  toPaise,
  fromPaise,
  roundCurrency,
  ceilRupees,
  addMoney,
  subtractMoney,
  multiplyMoney,
  percentOf,
  clampMoney,
  computePurchaseGst,
  ceilKm,
} from "../../../app/utils/money.js";

describe("utils/money", () => {
  describe("toPaise / fromPaise", () => {
    it("converts rupees to paise and back without float drift", () => {
      expect(toPaise(10.25)).toBe(1025);
      expect(toPaise(0.1 + 0.2)).toBe(30);
      expect(fromPaise(1025)).toBe(10.25);
    });

    it("treats null, undefined and non-finite values as zero", () => {
      expect(toPaise(null)).toBe(0);
      expect(toPaise(undefined)).toBe(0);
      expect(toPaise("abc")).toBe(0);
      expect(toPaise(Infinity)).toBe(0);
      expect(fromPaise(NaN)).toBe(0);
    });

    it("accepts numeric strings", () => {
      expect(toPaise("99.99")).toBe(9999);
    });
  });

  it("roundCurrency rounds to 2 decimals", () => {
    expect(roundCurrency(10.005)).toBe(10.01);
    expect(roundCurrency(10.004)).toBe(10);
  });

  it("ceilRupees rounds up to whole rupees and keeps sign", () => {
    expect(ceilRupees(10.01)).toBe(11);
    expect(ceilRupees(10)).toBe(10);
    expect(ceilRupees(-10.5)).toBe(-11);
    expect(ceilRupees(0)).toBe(0);
  });

  it("addMoney sums precisely", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(10, "5.5", null)).toBe(15.5);
    expect(addMoney()).toBe(0);
  });

  it("subtractMoney subtracts all subtrahends", () => {
    expect(subtractMoney(100, 30, 20.5)).toBe(49.5);
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
  });

  it("multiplyMoney multiplies by quantity", () => {
    expect(multiplyMoney(19.99, 3)).toBe(59.97);
    expect(multiplyMoney(10, null)).toBe(0);
  });

  it("percentOf computes percentages", () => {
    expect(percentOf(200, 18)).toBe(36);
    expect(percentOf(99.99, 5)).toBe(5);
    expect(percentOf(100, "abc")).toBe(0);
  });

  it("clampMoney clamps within bounds", () => {
    expect(clampMoney(-5)).toBe(0);
    expect(clampMoney(150, 0, 100)).toBe(100);
    expect(clampMoney(50.555, 0, 100)).toBe(50.56);
  });

  describe("computePurchaseGst", () => {
    it("computes EXCLUSIVE GST by default", () => {
      expect(computePurchaseGst(100, 18)).toEqual({
        basePrice: 100,
        gstAmount: 18,
        finalPrice: 118,
      });
    });

    it("computes INCLUSIVE GST (case-insensitive type)", () => {
      const result = computePurchaseGst(118, 18, "inclusive");
      expect(result.basePrice).toBe(100);
      expect(result.gstAmount).toBe(18);
      expect(result.finalPrice).toBe(118);
    });

    it("treats empty values as zero", () => {
      expect(computePurchaseGst("", "")).toEqual({ basePrice: 0, gstAmount: 0, finalPrice: 0 });
    });

    it.each([
      [-1, 5, "Purchase price cannot be negative"],
      ["abc", 5, "Purchase price must be a valid number"],
      [100, -1, "GST rate cannot be negative"],
      [100, 101, "GST rate cannot be more than 100%"],
      [100, "x", "GST rate must be a valid number"],
    ])("rejects price=%p rate=%p with a 400", (price, rate, message) => {
      expect(() => computePurchaseGst(price, rate)).toThrow(message);
      try {
        computePurchaseGst(price, rate);
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });
  });

  it("ceilKm rounds distances up and ignores invalid input", () => {
    expect(ceilKm(2.1)).toBe(3);
    expect(ceilKm(3)).toBe(3);
    expect(ceilKm(0)).toBe(0);
    expect(ceilKm(-4)).toBe(0);
    expect(ceilKm("bad")).toBe(0);
  });
});
