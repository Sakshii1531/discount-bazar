import { jest } from "@jest/globals";
import crypto from "crypto";

const mockOrderFindOne = jest.fn();
const mockPaymentFindOne = jest.fn();
const mockPaymentCreate = jest.fn();
const mockPaymentCountDocuments = jest.fn();
const mockWebhookEventCreate = jest.fn();
const mockWebhookEventUpdateOne = jest.fn();
const mockHandleOnlineOrderFinance = jest.fn();
const mockMoveOrderToSellerPendingAfterPayment = jest.fn();

const mockRazorpayOrdersCreate = jest.fn();
const mockRazorpayPaymentsFetch = jest.fn();

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: {
    findOne: mockOrderFindOne,
  },
}));

jest.unstable_mockModule("../app/models/payment.js", () => ({
  default: {
    findOne: mockPaymentFindOne,
    create: mockPaymentCreate,
    countDocuments: mockPaymentCountDocuments,
  },
}));

jest.unstable_mockModule("../app/models/paymentWebhookEvent.js", () => ({
  default: {
    create: mockWebhookEventCreate,
    updateOne: mockWebhookEventUpdateOne,
  },
}));

jest.unstable_mockModule("../app/services/finance/orderFinanceService.js", () => ({
  handleOnlineOrderFinance: mockHandleOnlineOrderFinance,
}));

jest.unstable_mockModule("../app/services/orderWorkflowService.js", () => ({
  afterPlaceOrderV2: jest.fn(),
}));

jest.unstable_mockModule("razorpay", () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      orders: {
        create: mockRazorpayOrdersCreate,
      },
      payments: {
        fetch: mockRazorpayPaymentsFetch,
      },
    })),
  };
});

describe("RazorpayAdapter & Integration Verification", () => {
  const TEST_KEY_ID = "rzp_test_1234567890ABCD";
  const TEST_KEY_SECRET = "test_secret_key_12345";
  const TEST_WEBHOOK_SECRET = "test_webhook_secret_67890";

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  afterAll(() => {
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  it("creates a Razorpay order with server-calculated amount", async () => {
    const { RazorpayAdapter } = await import(
      "../app/services/payment/providers/razorpay.adapter.js"
    );

    mockRazorpayOrdersCreate.mockResolvedValueOnce({
      id: "order_test_12345",
      amount: 15750,
      currency: "INR",
      receipt: "CHK-001-A1",
      status: "created",
    });

    const adapter = new RazorpayAdapter();
    const result = await adapter.initiatePayment({
      merchantOrderId: "CHK-001-A1",
      amountPaise: 15750,
      currency: "INR",
    });

    expect(result.gatewayOrderId).toBe("order_test_12345");
    expect(result.merchantOrderId).toBe("CHK-001-A1");
    expect(result.amount).toBe(15750);
    expect(result.keyId).toBe(TEST_KEY_ID);
    expect(mockRazorpayOrdersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 15750,
        currency: "INR",
        receipt: "CHK-001-A1",
      }),
    );
  });

  it("verifies valid Razorpay client payment signature and rejects invalid signature", async () => {
    const { RazorpayAdapter } = await import(
      "../app/services/payment/providers/razorpay.adapter.js"
    );

    const adapter = new RazorpayAdapter();
    const razorpayOrderId = "order_test_12345";
    const razorpayPaymentId = "pay_test_98765";

    const validSignature = crypto
      .createHmac("sha256", TEST_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    const isSignatureValid = adapter.validatePaymentSignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: validSignature,
    });

    expect(isSignatureValid).toBe(true);

    const isFakeSignatureValid = adapter.validatePaymentSignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: "invalid_tampered_signature",
    });

    expect(isFakeSignatureValid).toBe(false);
  });

  it("verifies valid Razorpay webhook signature over raw Buffer", async () => {
    const { RazorpayAdapter } = await import(
      "../app/services/payment/providers/razorpay.adapter.js"
    );

    const adapter = new RazorpayAdapter();
    const rawPayload = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_test_98765",
            order_id: "order_test_12345",
            status: "captured",
            notes: { merchantOrderId: "CHK-001-A1" },
          },
        },
      },
    });

    const rawBuffer = Buffer.from(rawPayload, "utf8");
    const validWebhookSignature = crypto
      .createHmac("sha256", TEST_WEBHOOK_SECRET)
      .update(rawBuffer)
      .digest("hex");

    const isWebhookValid = await adapter.validateWebhook({
      rawBody: rawBuffer,
      signature: validWebhookSignature,
    });

    expect(isWebhookValid).toBe(true);

    const isInvalidWebhook = await adapter.validateWebhook({
      rawBody: rawBuffer,
      signature: "forged_webhook_signature",
    });

    expect(isInvalidWebhook).toBe(false);
  });

  it("resolves PhonePeAdapter when PAYMENT_PROVIDER=phonepe", async () => {
    process.env.PAYMENT_PROVIDER = "phonepe";
    const { getActivePaymentProvider, __resetPaymentProviderForTests } =
      await import("../app/services/payment/providerRegistry.js");

    __resetPaymentProviderForTests();
    const provider = getActivePaymentProvider();
    expect(provider.providerName).toBe("PHONEPE");
  });

  it("resolves RazorpayAdapter when PAYMENT_PROVIDER=razorpay", async () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    const { getActivePaymentProvider, __resetPaymentProviderForTests } =
      await import("../app/services/payment/providerRegistry.js");

    __resetPaymentProviderForTests();
    const provider = getActivePaymentProvider();
    expect(provider.providerName).toBe("RAZORPAY");
  });
});
