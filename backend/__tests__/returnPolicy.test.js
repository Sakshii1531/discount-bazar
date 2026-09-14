import {
  isReturnEligible,
  decorateOrderWithReturnEligibility,
  ALLOWED_RETURN_REASONS,
} from "../app/utils/returnEligibilityHelper.js";
import {
  returnPolicyJoiSchema,
  parseAndValidateReturnPolicy,
} from "../app/validation/returnPolicyValidation.js";

describe("Product Return Policy & Window System Unit Tests", () => {
  describe("Return Policy Validation Schema", () => {
    test("validates non-returnable product default policy", () => {
      const input = { isReturnable: false, returnWindowDays: 0, returnReasons: [] };
      const { value, error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeNull();
      expect(value).toEqual({
        isReturnable: false,
        returnWindowDays: 0,
        returnReasons: [],
      });
    });

    test("validates returnable product with valid return window and reasons", () => {
      const input = {
        isReturnable: true,
        returnWindowDays: 7,
        returnReasons: ["Damaged Product", "Wrong Product"],
      };
      const { value, error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeNull();
      expect(value.isReturnable).toBe(true);
      expect(value.returnWindowDays).toBe(7);
      expect(value.returnReasons).toEqual(["Damaged Product", "Wrong Product"]);
    });

    test("rejects returnable product without return window", () => {
      const input = {
        isReturnable: true,
        returnWindowDays: 0,
        returnReasons: ["Damaged Product"],
      };
      const { error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeTruthy();
    });

    test("rejects negative return window days", () => {
      const input = {
        isReturnable: true,
        returnWindowDays: -5,
        returnReasons: ["Damaged Product"],
      };
      const { error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeTruthy();
    });

    test("rejects decimal return window days", () => {
      const input = {
        isReturnable: true,
        returnWindowDays: 5.5,
        returnReasons: ["Damaged Product"],
      };
      const { error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeTruthy();
    });

    test("rejects return window greater than 30 days", () => {
      const input = {
        isReturnable: true,
        returnWindowDays: 31,
        returnReasons: ["Damaged Product"],
      };
      const { error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeTruthy();
    });

    test("defaults return reasons when returnable product has empty return reasons array", () => {
      const input = {
        isReturnable: true,
        returnWindowDays: 7,
        returnReasons: [],
      };
      const { value, error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeNull();
      expect(value.returnReasons).toEqual(ALLOWED_RETURN_REASONS);
    });

    test("rejects unapproved return reason string", () => {
      const input = {
        isReturnable: true,
        returnWindowDays: 7,
        returnReasons: ["Changed My Mind"],
      };
      const { error } = parseAndValidateReturnPolicy(input);
      expect(error).toBeTruthy();
    });
  });

  describe("Return Eligibility Helper (isReturnEligible)", () => {
    const deliveryDate = new Date("2026-08-01T10:00:00.000Z");

    test("allows return for returnable item delivered within window", () => {
      const item = {
        name: "Test Item",
        returnPolicy: { isReturnable: true, returnWindowDays: 7, returnReasons: ["Damaged Product"] },
        returnStatus: "none",
      };

      const now = new Date("2026-08-04T10:00:00.000Z"); // 3 days after delivery
      const res = isReturnEligible(item, deliveryDate, "delivered", now);

      expect(res.returnEligible).toBe(true);
      expect(res.remainingReturnDays).toBe(4);
    });

    test("allows return on the last day of return window", () => {
      const item = {
        name: "Test Item",
        returnPolicy: { isReturnable: true, returnWindowDays: 7, returnReasons: ["Damaged Product"] },
        returnStatus: "none",
      };

      const now = new Date("2026-08-08T09:59:59.000Z"); // exact 7 days
      const res = isReturnEligible(item, deliveryDate, "delivered", now);

      expect(res.returnEligible).toBe(true);
      expect(res.remainingReturnDays).toBe(1);
    });

    test("rejects return when return window has expired by 1 second", () => {
      const item = {
        name: "Test Item",
        returnPolicy: { isReturnable: true, returnWindowDays: 7, returnReasons: ["Damaged Product"] },
        returnStatus: "none",
      };

      const now = new Date("2026-08-08T10:00:01.000Z"); // 7 days + 1 second
      const res = isReturnEligible(item, deliveryDate, "delivered", now);

      expect(res.returnEligible).toBe(false);
      expect(res.remainingReturnDays).toBe(0);
      expect(res.reason).toBe("Return Window Closed");
    });

    test("rejects return for non-returnable product snapshot", () => {
      const item = {
        name: "Test Item",
        returnPolicy: { isReturnable: false, returnWindowDays: 0, returnReasons: [] },
        returnStatus: "none",
      };

      const now = new Date("2026-08-02T10:00:00.000Z");
      const res = isReturnEligible(item, deliveryDate, "delivered", now);

      expect(res.returnEligible).toBe(false);
      expect(res.reason).toBe("Non Returnable");
    });

    test("rejects return when order status is pending or confirmed (not delivered)", () => {
      const item = {
        name: "Test Item",
        returnPolicy: { isReturnable: true, returnWindowDays: 7, returnReasons: ["Damaged Product"] },
        returnStatus: "none",
      };

      const res = isReturnEligible(item, deliveryDate, "confirmed", new Date());
      expect(res.returnEligible).toBe(false);
      expect(res.reason).toBe("Order not delivered");
    });

    test("rejects return when return request already exists", () => {
      const item = {
        name: "Test Item",
        returnPolicy: { isReturnable: true, returnWindowDays: 7, returnReasons: ["Damaged Product"] },
        returnStatus: "requested",
      };

      const res = isReturnEligible(item, deliveryDate, "delivered", new Date());
      expect(res.returnEligible).toBe(false);
    });
  });

  describe("Order Snapshot Isolation Test", () => {
    test("decorates order with return eligibility metadata based on item snapshot", () => {
      const dummyOrder = {
        status: "delivered",
        deliveredAt: "2026-08-01T10:00:00.000Z",
        items: [
          {
            name: "Item 1",
            returnPolicy: { isReturnable: true, returnWindowDays: 5, returnReasons: ["Wrong Product"] },
            returnStatus: "none",
          },
          {
            name: "Item 2",
            returnPolicy: { isReturnable: false, returnWindowDays: 0, returnReasons: [] },
            returnStatus: "none",
          },
        ],
      };

      const now = new Date("2026-08-03T10:00:00.000Z");
      const decorated = decorateOrderWithReturnEligibility(dummyOrder, now);

      expect(decorated.items[0].returnEligible).toBe(true);
      expect(decorated.items[0].remainingReturnDays).toBe(3);

      expect(decorated.items[1].returnEligible).toBe(false);
      expect(decorated.items[1].remainingReturnDays).toBe(0);
    });
  });
});
