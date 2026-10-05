import { jest } from "@jest/globals";

const mockRedis = { get: jest.fn(), set: jest.fn() };
let redisEnabled = true;
jest.unstable_mockModule("../../../app/config/redis.js", () => ({
  getRedisClient: () => (redisEnabled ? mockRedis : null),
  isRedisEnabled: () => redisEnabled,
}));
jest.unstable_mockModule("../../../app/services/finance/ledgerService.js", () => ({
  getLedgerEntries: jest.fn(),
}));

const { canTransition, assertTransition, TRANSITIONS } = await import(
  "../../../app/services/orderStateMachine.js"
);
const {
  WORKFLOW_STATUS,
  legacyStatusFromWorkflow,
  workflowFromLegacyStatus,
  DEFAULT_SELLER_TIMEOUT_MS,
  DEFAULT_DELIVERY_TIMEOUT_MS,
} = await import("../../../app/constants/orderWorkflow.js");
const { canTransitionPaymentStatus, PAYMENT_STATUS } = await import("../../../app/constants/payment.js");
const { ORDER_PAYMENT_STATUS } = await import("../../../app/constants/finance.js");
const { resolvePosPayment } = await import("../../../app/services/posPayment.js");
const { shouldThrottle } = await import("../../../app/services/delivery/locationThrottleService.js");
const { buildLedgerCsv, exportFinanceStatement } = await import(
  "../../../app/services/finance/statementService.js"
);
const ledgerService = await import("../../../app/services/finance/ledgerService.js");

const S = WORKFLOW_STATUS;

describe("orders: workflow state machine", () => {
  it("allows the happy path", () => {
    const path = [
      S.CREATED,
      S.SELLER_PENDING,
      S.SELLER_ACCEPTED,
      S.DELIVERY_SEARCH,
      S.DELIVERY_ASSIGNED,
      S.PICKUP_READY,
      S.OUT_FOR_DELIVERY,
      S.DELIVERED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("treats same-state as allowed and missing values as invalid", () => {
    expect(canTransition(S.DELIVERED, S.DELIVERED)).toBe(true);
    expect(canTransition(null, S.DELIVERED)).toBe(false);
    expect(canTransition(S.CREATED, undefined)).toBe(false);
    expect(canTransition("UNKNOWN", S.CREATED)).toBe(false);
  });

  it("terminal states cannot move", () => {
    expect(TRANSITIONS[S.DELIVERED].size).toBe(0);
    expect(TRANSITIONS[S.CANCELLED].size).toBe(0);
    expect(canTransition(S.DELIVERED, S.CANCELLED)).toBe(false);
  });

  it("every non-terminal pre-delivery state can be cancelled", () => {
    for (const from of [S.SELLER_PENDING, S.SELLER_ACCEPTED, S.DELIVERY_SEARCH, S.DELIVERY_ASSIGNED, S.PICKUP_READY, S.OUT_FOR_DELIVERY]) {
      expect(canTransition(from, S.CANCELLED)).toBe(true);
    }
  });

  it("assertTransition throws 409 for invalid moves", () => {
    expect(() => assertTransition(S.CREATED, S.DELIVERED)).toThrow("Invalid transition CREATED -> DELIVERED");
    try {
      assertTransition(S.CREATED, S.DELIVERED);
    } catch (err) {
      expect(err.statusCode).toBe(409);
    }
    expect(() => assertTransition(S.CREATED, S.SELLER_PENDING)).not.toThrow();
  });

  it("maps workflow ↔ legacy status", () => {
    expect(legacyStatusFromWorkflow(S.SELLER_ACCEPTED)).toBe("confirmed");
    expect(legacyStatusFromWorkflow(S.OUT_FOR_DELIVERY)).toBe("out_for_delivery");
    expect(legacyStatusFromWorkflow(S.CANCELLED)).toBe("cancelled");
    expect(legacyStatusFromWorkflow("???")).toBe("pending");
    expect(workflowFromLegacyStatus("PACKED")).toBe(S.DELIVERY_ASSIGNED);
    expect(workflowFromLegacyStatus("delivered")).toBe(S.DELIVERED);
    expect(workflowFromLegacyStatus(undefined)).toBe(S.SELLER_PENDING);
  });

  it("reads timeouts from env", () => {
    const prev = process.env.SELLER_TIMEOUT_MS;
    process.env.SELLER_TIMEOUT_MS = "5000";
    expect(DEFAULT_SELLER_TIMEOUT_MS()).toBe(5000);
    delete process.env.SELLER_TIMEOUT_MS;
    expect(DEFAULT_SELLER_TIMEOUT_MS()).toBe(3600000);
    expect(DEFAULT_DELIVERY_TIMEOUT_MS()).toBeGreaterThan(0);
    if (prev !== undefined) process.env.SELLER_TIMEOUT_MS = prev;
  });
});

describe("payments: status transitions", () => {
  it("allows capture and refund flow", () => {
    expect(canTransitionPaymentStatus(PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING)).toBe(true);
    expect(canTransitionPaymentStatus(PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CAPTURED)).toBe(true);
    expect(canTransitionPaymentStatus(PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.REFUNDED)).toBe(true);
  });

  it("blocks moves out of terminal statuses", () => {
    expect(canTransitionPaymentStatus(PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CAPTURED)).toBe(false);
    expect(canTransitionPaymentStatus(PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.CAPTURED)).toBe(false);
    expect(canTransitionPaymentStatus(PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.FAILED)).toBe(false);
    expect(canTransitionPaymentStatus(null, PAYMENT_STATUS.CAPTURED)).toBe(false);
  });
});

describe("seller POS: resolvePosPayment", () => {
  it("CASH collects full total and records tendered cash", () => {
    const out = resolvePosPayment({ method: "CASH", grandTotal: 99.5, cashTendered: 100 });
    expect(out.paymentStatus).toBe(ORDER_PAYMENT_STATUS.CASH_COLLECTED);
    expect(out.codCollectedAmount).toBe(99.5);
    expect(out.posCashTendered).toBe(100);
  });

  it("CASH rejects insufficient tendered amount", () => {
    expect(() => resolvePosPayment({ method: "CASH", grandTotal: 100, cashTendered: 50 })).toThrow(
      /less than the bill total/,
    );
  });

  it.each(["CARD", "QR", "OTHER"])("%s is marked PAID online", (method) => {
    const out = resolvePosPayment({ method, grandTotal: 200 });
    expect(out.paymentStatus).toBe(ORDER_PAYMENT_STATUS.PAID);
    expect(out.payment).toEqual({ method: "online", status: "completed" });
    expect(out.codCollectedAmount).toBe(0);
  });

  it("CREDIT partial payment stays pending", () => {
    const out = resolvePosPayment({ method: "CREDIT", grandTotal: 500, amountPaid: 200 });
    expect(out.posAmountPaid).toBe(200);
    expect(out.paymentStatus).toBe(ORDER_PAYMENT_STATUS.PENDING_CASH_COLLECTION);
    expect(out.payment.status).toBe("pending");
  });

  it("CREDIT paid in full caps at total", () => {
    const out = resolvePosPayment({ method: "CREDIT", grandTotal: 500, amountPaid: 900 });
    expect(out.posAmountPaid).toBe(500);
    expect(out.paymentStatus).toBe(ORDER_PAYMENT_STATUS.CASH_COLLECTED);
  });

  it("SPLIT must add up and tracks cash part", () => {
    const out = resolvePosPayment({
      method: "SPLIT",
      grandTotal: 300,
      payments: [
        { method: "CASH", amount: 100 },
        { method: "QR", amount: 200 },
        { method: "CARD", amount: 0 },
      ],
    });
    expect(out.posPayments).toHaveLength(2);
    expect(out.codCollectedAmount).toBe(100);
    expect(out.paymentStatus).toBe(ORDER_PAYMENT_STATUS.CASH_COLLECTED);
  });

  it("SPLIT without cash is PAID", () => {
    const out = resolvePosPayment({
      method: "SPLIT",
      grandTotal: 300,
      payments: [
        { method: "CARD", amount: 100 },
        { method: "QR", amount: 200 },
      ],
    });
    expect(out.paymentStatus).toBe(ORDER_PAYMENT_STATUS.PAID);
  });

  it("SPLIT rejects mismatched or empty lines", () => {
    expect(() => resolvePosPayment({ method: "SPLIT", grandTotal: 300, payments: [] })).toThrow(
      "Enter the split payment amounts",
    );
    expect(() =>
      resolvePosPayment({ method: "SPLIT", grandTotal: 300, payments: [{ method: "CASH", amount: 100 }] }),
    ).toThrow(/must add up/);
  });
});

describe("delivery: location throttle", () => {
  beforeEach(() => {
    redisEnabled = true;
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
  });

  it("never throttles without redis", async () => {
    redisEnabled = false;
    expect(await shouldThrottle("d1", 1, 1)).toBe(false);
  });

  it("stores first location and does not throttle", async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await shouldThrottle("d1", 22.7, 75.8)).toBe(false);
    expect(mockRedis.set).toHaveBeenCalledWith("loc:last:d1", expect.any(String), "EX", 3600);
  });

  it("throttles rapid updates without movement", async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ lat: 22.7, lng: 75.8, t: Date.now() }));
    expect(await shouldThrottle("d1", 22.7, 75.8)).toBe(true);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("does not throttle when moved far enough", async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ lat: 22.7, lng: 75.8, t: Date.now() }));
    expect(await shouldThrottle("d1", 22.71, 75.8)).toBe(false);
  });

  it("fails open on redis errors", async () => {
    mockRedis.get.mockRejectedValue(new Error("redis down"));
    expect(await shouldThrottle("d1", 1, 1)).toBe(false);
  });
});

describe("finance: ledger CSV statement", () => {
  it("builds header-only CSV for no entries", () => {
    expect(buildLedgerCsv().split("\n")).toHaveLength(1);
  });

  it("escapes commas, quotes and newlines", () => {
    const csv = buildLedgerCsv([
      {
        transactionId: "T1",
        createdAt: "2026-01-01T00:00:00Z",
        type: "REFUND",
        direction: "DEBIT",
        amount: 10,
        status: "COMPLETED",
        actorType: "CUSTOMER",
        description: 'Refund, "late"\nretry',
      },
    ]);
    const [, row] = csv.split(/\n(?=T1)/);
    expect(row.startsWith("T1,2026-01-01T00:00:00.000Z,REFUND,DEBIT,10,COMPLETED,,CUSTOMER")).toBe(true);
    expect(row).toContain('"Refund, ""late""\nretry"');
  });

  it("exportFinanceStatement caps limit and names file", async () => {
    ledgerService.getLedgerEntries.mockResolvedValue({ items: [] });
    const result = await exportFinanceStatement({ limit: 999999 });
    expect(ledgerService.getLedgerEntries).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 10000 }),
    );
    expect(result.fileName).toMatch(/^finance_statement_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.totalRows).toBe(0);
  });
});
