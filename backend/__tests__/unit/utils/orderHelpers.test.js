import mongoose from "mongoose";
import { distanceMeters } from "../../../app/utils/geoUtils.js";
import { calculateDistance, handleResponse } from "../../../app/utils/helper.js";
import {
  parsePositiveInt,
  getReturnEligibilityDelayMinutes,
  getReturnWindowMinutes,
  computeReturnWindowForOrder,
  computeReturnWindowDates,
} from "../../../app/utils/returnWindow.js";
import {
  isReturnEligible,
  decorateOrderWithReturnEligibility,
  ALLOWED_RETURN_REASONS,
  VALID_RETURN_WINDOWS,
} from "../../../app/utils/returnEligibilityHelper.js";
import {
  normalizeOrderRouteParam,
  orderMatchQueryFromRouteParam,
  orderMatchQueryFlexible,
} from "../../../app/utils/orderLookup.js";
import { generateOTP, MOCK_OTP } from "../../../app/utils/otp.js";

const DAY = 24 * 60 * 60 * 1000;

function mockRes() {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe("utils/geo distance", () => {
  it("returns 0 for identical points", () => {
    expect(distanceMeters(22.7, 75.8, 22.7, 75.8)).toBe(0);
    expect(calculateDistance(22.7, 75.8, 22.7, 75.8)).toBe(0);
  });

  it("computes Indore → Bhopal (~170-190 km)", () => {
    const km = calculateDistance(22.7196, 75.8577, 23.2599, 77.4126);
    expect(km).toBeGreaterThan(150);
    expect(km).toBeLessThan(200);
    expect(distanceMeters(22.7196, 75.8577, 23.2599, 77.4126) / 1000).toBeCloseTo(km, 3);
  });
});

describe("utils/helper handleResponse", () => {
  it("wraps objects in result and strips sensitive fields", () => {
    const res = mockRes();
    handleResponse(res, 200, "ok", { name: "A", password: "x", __v: 1, updatedAt: new Date() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, error: false, message: "ok", result: { name: "A" } });
  });

  it("wraps arrays in results", () => {
    const res = mockRes();
    handleResponse(res, 200, "list", [{ a: 1, password: "p" }]);
    expect(res.body.results).toEqual([{ a: 1 }]);
  });

  it("marks non-2xx as error and stringifies ObjectIds", () => {
    const res = mockRes();
    const id = new mongoose.Types.ObjectId();
    handleResponse(res, 400, "bad", { id, when: new Date(0) });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe(true);
    expect(res.body.result.id).toBe(id.toString());
    expect(res.body.result.when).toEqual(new Date(0));
  });

  it("calls toObject on mongoose-like docs", () => {
    const res = mockRes();
    handleResponse(res, 201, "created", { toObject: () => ({ x: 1, password: "s" }) });
    expect(res.body.result).toEqual({ x: 1 });
  });
});

describe("utils/returnWindow", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("parsePositiveInt falls back on invalid input", () => {
    expect(parsePositiveInt("5", 1)).toBe(5);
    expect(parsePositiveInt("0", 1)).toBe(0);
    expect(parsePositiveInt("-3", 1)).toBe(1);
    expect(parsePositiveInt("abc", 7)).toBe(7);
  });

  it("reads delay/window from env with defaults", () => {
    delete process.env.RETURN_ELIGIBILITY_DELAY_MINUTES;
    delete process.env.RETURN_WINDOW_MINUTES;
    expect(getReturnEligibilityDelayMinutes()).toBe(2);
    expect(getReturnWindowMinutes()).toBe(2);
    process.env.RETURN_WINDOW_MINUTES = "60";
    expect(getReturnWindowMinutes()).toBe(60);
  });

  it("computeReturnWindowForOrder never expires before eligibility", () => {
    process.env.RETURN_ELIGIBILITY_DELAY_MINUTES = "30";
    process.env.RETURN_WINDOW_MINUTES = "10";
    const deliveredAt = new Date("2026-01-01T00:00:00Z");
    const result = computeReturnWindowForOrder({ deliveredAt });
    expect(result.eligibleAt.getTime()).toBe(deliveredAt.getTime() + 30 * 60000);
    expect(result.windowExpiresAt.getTime()).toBe(result.eligibleAt.getTime());
  });

  it("computeReturnWindowForOrder prefers persisted dates", () => {
    const eligibleAt = new Date("2026-01-02T00:00:00Z");
    const windowExpiresAt = new Date("2026-01-05T00:00:00Z");
    const result = computeReturnWindowForOrder({
      deliveredAt: new Date("2026-01-01T00:00:00Z"),
      returnEligibleAt: eligibleAt,
      returnWindowExpiresAt: windowExpiresAt,
    });
    expect(result.eligibleAt).toBe(eligibleAt);
    expect(result.windowExpiresAt).toBe(windowExpiresAt);
  });

  it("computeReturnWindowDates derives from delivered date", () => {
    process.env.RETURN_ELIGIBILITY_DELAY_MINUTES = "1";
    process.env.RETURN_WINDOW_MINUTES = "5";
    const start = new Date("2026-01-01T00:00:00Z");
    const { eligibleAt, windowExpiresAt } = computeReturnWindowDates(start);
    expect(eligibleAt.getTime() - start.getTime()).toBe(60000);
    expect(windowExpiresAt.getTime() - start.getTime()).toBe(5 * 60000);
  });
});

describe("utils/returnEligibilityHelper", () => {
  const deliveredAt = new Date("2026-01-01T00:00:00Z");
  const returnable = { returnPolicy: { isReturnable: true, returnWindowDays: 7 } };

  it("exposes reasons and windows", () => {
    expect(ALLOWED_RETURN_REASONS).toContain("Damaged Product");
    expect(VALID_RETURN_WINDOWS).toEqual([1, 2, 3, 5, 7, 10, 15, 30]);
  });

  it.each([
    [null, deliveredAt, "delivered", "Item not found"],
    [{}, deliveredAt, "delivered", "Non Returnable"],
    [returnable, deliveredAt, "pending", "Order not delivered"],
    [returnable, null, "delivered", "Delivery date missing"],
    [returnable, "not-a-date", "delivered", "Invalid delivery date"],
    [{ ...returnable, returnStatus: "requested" }, deliveredAt, "delivered", "Return already requested"],
    [{ returnPolicy: { isReturnable: true, returnWindowDays: 0 } }, deliveredAt, "delivered", "Non Returnable"],
  ])("ineligible case → %#", (item, date, status, reason) => {
    const result = isReturnEligible(item, date, status, deliveredAt.getTime() + DAY);
    expect(result).toEqual({ returnEligible: false, remainingReturnDays: 0, reason });
  });

  it("is eligible inside window with remaining days", () => {
    const result = isReturnEligible(returnable, deliveredAt, "DELIVERED", deliveredAt.getTime() + 2 * DAY);
    expect(result).toEqual({ returnEligible: true, remainingReturnDays: 5, reason: "Eligible for Return" });
  });

  it("closes window after expiry", () => {
    const result = isReturnEligible(returnable, deliveredAt, "delivered", deliveredAt.getTime() + 8 * DAY);
    expect(result.reason).toBe("Return Window Closed");
  });

  it("decorates order items and detects wallet payments", () => {
    const order = {
      orderStatus: "delivered",
      deliveredAt,
      walletAmount: 100,
      pricing: { total: 100 },
      payment: { method: "online" },
      items: [returnable, { name: "no policy" }],
    };
    const decorated = decorateOrderWithReturnEligibility(order, deliveredAt.getTime() + DAY);
    expect(decorated.items[0].returnEligible).toBe(true);
    expect(decorated.items[1].returnEligible).toBe(false);
    expect(decorated.items[1].returnPolicy.isReturnable).toBe(false);
    expect(decorated.payment.method).toBe("wallet");
    expect(decorated.paymentMode).toBe("WALLET");
  });

  it("returns falsy orders unchanged", () => {
    expect(decorateOrderWithReturnEligibility(null)).toBeNull();
  });
});

describe("utils/orderLookup", () => {
  it("decodes and trims route params", () => {
    expect(normalizeOrderRouteParam("%20ORD123%20")).toBe("ORD123");
    expect(normalizeOrderRouteParam(undefined)).toBe("");
  });

  it("matches ObjectIds by _id and others by orderId", () => {
    const id = new mongoose.Types.ObjectId().toString();
    expect(orderMatchQueryFromRouteParam(id)._id.toString()).toBe(id);
    expect(orderMatchQueryFromRouteParam("ORD-1")).toEqual({ orderId: "ORD-1" });
    expect(orderMatchQueryFromRouteParam("")).toBeNull();
  });

  it("flexible query matches orderId or checkoutGroupId case-insensitively", () => {
    const q = orderMatchQueryFlexible("ord.1");
    expect(q.$or).toHaveLength(4);
    expect(q.$or[1].orderId.test("ORD.1")).toBe(true);
    expect(q.$or[1].orderId.test("ORDX1")).toBe(false);
    expect(orderMatchQueryFlexible(" ")).toBeNull();
  });
});

describe("utils/otp", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("returns mock OTP outside production", () => {
    process.env.NODE_ENV = "test";
    delete process.env.USE_REAL_SMS;
    expect(generateOTP()).toBe(MOCK_OTP);
  });

  it("refuses mock OTP in production unless allowed", () => {
    process.env.NODE_ENV = "production";
    delete process.env.USE_REAL_SMS;
    delete process.env.USE_MOCK_OTP;
    delete process.env.ALLOW_PRODUCTION_MOCK_OTP;
    expect(() => generateOTP()).toThrow("Mock OTP mode is disabled in production");
    process.env.USE_MOCK_OTP = "true";
    expect(generateOTP()).toBe(MOCK_OTP);
  });

  it("generates random numeric OTP when real SMS is enabled", () => {
    process.env.USE_REAL_SMS = "true";
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{4,}$/);
  });
});
