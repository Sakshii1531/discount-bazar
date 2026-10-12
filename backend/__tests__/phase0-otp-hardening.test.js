import { jest } from "@jest/globals";

const mockCustomerFindOne = jest.fn();
const mockCustomerCreate = jest.fn();
const mockCustomerFindById = jest.fn();

jest.unstable_mockModule("../app/models/customer.js", () => ({
  default: {
    findOne: mockCustomerFindOne,
    create: mockCustomerCreate,
    findById: mockCustomerFindById,
  },
}));

const mockSessionFindOne = jest.fn();
const mockSessionFindOneAndDelete = jest.fn();
const mockSessionSave = jest.fn();

jest.unstable_mockModule("../app/models/otpVerification.js", () => {
  function OtpVerification(fields) {
    Object.assign(this, fields);
    this._id = "session-new";
    this.save = mockSessionSave;
  }
  OtpVerification.findOne = mockSessionFindOne;
  OtpVerification.findOneAndDelete = mockSessionFindOneAndDelete;
  return { default: OtpVerification };
});

jest.unstable_mockModule("../app/utils/otp.js", () => ({
  generateOTP: jest.fn(() => "1234"),
  useRealSMS: jest.fn(() => false),
}));

// The resend cooldown is only enforced in production unless explicitly enabled.
process.env.ENABLE_RATE_LIMIT_DEV = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "jwt-test-secret";

const {
  completeCustomerRegistration,
  issueCustomerOtp,
  issueRegistrationToken,
  verifyCustomerOtpCode,
} = await import("../app/services/otpAuthService.js");

function buildCustomer(overrides = {}) {
  return {
    _id: "customer-1",
    name: "Test User",
    phone: "+919876543210",
    isVerified: true,
    otpHash: null,
    otpExpiresAt: null,
    otpFailedAttempts: 0,
    otpLockedUntil: null,
    otpLastSentAt: null,
    otpSessionVersion: 0,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildSession(overrides = {}) {
  return {
    _id: "session-1",
    otpHash: null,
    expiresAt: null,
    failedAttempts: 0,
    lockedUntil: null,
    lastSentAt: null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function mockFindOneSelect(customerOrNull) {
  mockCustomerFindOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(customerOrNull),
  });
}

function mockSession(sessionOrNull) {
  mockSessionFindOne.mockReturnValue({
    select: jest.fn().mockResolvedValue(sessionOrNull),
  });
}

async function hashFor(phone, otp) {
  // Issue an OTP into a throwaway session to capture the service's hash.
  mockFindOneSelect(null);
  mockSession(null);
  let captured;
  mockSessionSave.mockImplementationOnce(function save() {
    captured = this.otpHash;
    return Promise.resolve(this);
  });
  const prev = process.env.ENABLE_RATE_LIMIT_DEV;
  process.env.ENABLE_RATE_LIMIT_DEV = "false";
  await issueCustomerOtp({ rawPhone: phone, flow: "login" });
  process.env.ENABLE_RATE_LIMIT_DEV = prev;
  return captured;
}

describe("Phase 0 OTP hardening", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OTP_RESEND_COOLDOWN_SECONDS = "60";
    process.env.OTP_MAX_FAILED_ATTEMPTS = "5";
    process.env.OTP_LOCKOUT_MINUTES = "10";
    process.env.OTP_HASH_SECRET = "otp-test-secret";
    mockSessionSave.mockResolvedValue(true);
  });

  it("enforces resend cooldown", async () => {
    const customer = buildCustomer({
      phone: "+919876543211",
      otpLastSentAt: new Date(Date.now() - 10 * 1000),
    });
    mockFindOneSelect(customer);

    await expect(
      issueCustomerOtp({
        rawPhone: "9876543211",
        flow: "login",
        ipAddress: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("locks out number after repeated OTP verification failures", async () => {
    const customer = buildCustomer({
      phone: "+919876543212",
      otpHash: "ab".repeat(32),
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      otpFailedAttempts: 4,
    });
    mockFindOneSelect(customer);

    await expect(
      verifyCustomerOtpCode({
        rawPhone: "9876543212",
        otp: "9999",
        ipAddress: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ statusCode: 423 });

    expect(customer.save).toHaveBeenCalled();
    expect(customer.otpLockedUntil).toBeTruthy();
  });

  it("never stores raw OTP in DB fields", async () => {
    const customer = buildCustomer({
      phone: "+919876543213",
      otpLastSentAt: new Date(Date.now() - 120 * 1000),
    });
    mockFindOneSelect(customer);

    await issueCustomerOtp({
      rawPhone: "9876543213",
      flow: "login",
      ipAddress: "127.0.0.1",
    });

    expect(customer.otp).toBeUndefined();
    expect(customer.otpHash).toBeTruthy();
    expect(customer.otpHash).not.toBe("1234");
    expect(customer.save).toHaveBeenCalled();
  });
});

describe("customer registration via verified mobile number", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OTP_RESEND_COOLDOWN_SECONDS = "60";
    process.env.OTP_MAX_FAILED_ATTEMPTS = "5";
    process.env.OTP_LOCKOUT_MINUTES = "10";
    process.env.OTP_HASH_SECRET = "otp-test-secret";
    mockSessionSave.mockResolvedValue(true);
  });

  it("sends an OTP to a new number without creating an account", async () => {
    mockFindOneSelect(null);
    mockSession(null);

    await issueCustomerOtp({ rawPhone: "9876543220", flow: "login" });

    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockSessionSave).toHaveBeenCalled();
  });

  it("reports a new user after OTP verification, without creating an account", async () => {
    const otpHash = await hashFor("9876543221", "1234");
    jest.clearAllMocks();
    const session = buildSession({ otpHash, expiresAt: new Date(Date.now() + 60_000) });
    mockFindOneSelect(null);
    mockSession(session);
    mockSessionFindOneAndDelete.mockResolvedValue(session);

    const result = await verifyCustomerOtpCode({ rawPhone: "9876543221", otp: "1234" });

    expect(result).toEqual({ isNewUser: true, phone: "+919876543221" });
    expect(mockSessionFindOneAndDelete).toHaveBeenCalled();
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("rejects a registration OTP that was already consumed", async () => {
    const otpHash = await hashFor("9876543222", "1234");
    jest.clearAllMocks();
    mockFindOneSelect(null);
    mockSession(buildSession({ otpHash, expiresAt: new Date(Date.now() + 60_000) }));
    mockSessionFindOneAndDelete.mockResolvedValue(null);

    await expect(
      verifyCustomerOtpCode({ rawPhone: "9876543222", otp: "1234" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("locks a pending registration after repeated failures", async () => {
    const session = buildSession({
      otpHash: "ab".repeat(32),
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 4,
    });
    mockFindOneSelect(null);
    mockSession(session);

    await expect(
      verifyCustomerOtpCode({ rawPhone: "9876543223", otp: "9999" }),
    ).rejects.toMatchObject({ statusCode: 423 });
    expect(session.lockedUntil).toBeTruthy();
    expect(session.expiresAt >= session.lockedUntil).toBe(true);
  });

  it("creates the account with the given name on completion", async () => {
    const created = buildCustomer({ name: "Asha", phone: "+919876543224" });
    mockCustomerFindOne.mockResolvedValue(null);
    mockCustomerCreate.mockResolvedValue(created);

    const customer = await completeCustomerRegistration({
      registrationToken: issueRegistrationToken("+919876543224"),
      name: "Asha",
    });

    expect(customer).toBe(created);
    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Asha", phone: "+919876543224", isVerified: true }),
    );
  });

  it("returns the existing account on a retried completion instead of duplicating it", async () => {
    const existing = buildCustomer({ name: "Asha", phone: "+919876543225" });
    mockCustomerFindOne.mockResolvedValue(existing);

    const customer = await completeCustomerRegistration({
      registrationToken: issueRegistrationToken("+919876543225"),
      name: "Someone Else",
    });

    expect(customer).toBe(existing);
    expect(existing.name).toBe("Asha");
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("resolves a duplicate-key race to the account that won", async () => {
    const winner = buildCustomer({ phone: "+919876543226" });
    mockCustomerFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    mockCustomerCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));

    const customer = await completeCustomerRegistration({
      registrationToken: issueRegistrationToken("+919876543226"),
      name: "Asha",
    });

    expect(customer).toBe(winner);
  });

  it("rejects a forged or login token as a registration token", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const loginToken = jwt.sign({ id: "x", role: "customer" }, process.env.JWT_SECRET);

    await expect(
      completeCustomerRegistration({ registrationToken: loginToken, name: "Asha" }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
