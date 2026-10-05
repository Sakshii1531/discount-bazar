/**
 * API E2E — customer OTP account-takeover checks.
 *
 * Runs with USE_REAL_SMS=true so OTPs should be random. The SMS provider call
 * fails here (no credentials) and the service falls back to mock delivery in
 * non-production, which lets us observe which code it actually issued.
 *
 * Regression guard: signup OTPs used to be forced to a fixed code even for
 * phone numbers that already had an account. Fixed in otpAuthService.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
const prevSms = process.env.USE_REAL_SMS;
beforeAll(async () => {
  app = await startTestApp();
  process.env.USE_REAL_SMS = "true";
  process.env.USE_MOCK_OTP = "false";
});
afterEach(clearDatabase);
afterAll(async () => {
  process.env.USE_REAL_SMS = prevSms;
  await stopTestApp();
});

describe("security: customer OTP", () => {
  it("cannot take over an existing account with a signup request and OTP 1234", async () => {
    const victim = await fx.createCustomer({ name: "Victim", phone: "+919812345678", isVerified: true });

    await request(app).post("/api/customer/send-signup-otp").send({ name: "Attacker", phone: "9812345678" });
    const res = await request(app).post("/api/customer/verify-otp").send({ phone: "9812345678", otp: "1234" });

    expect(res.status).not.toBe(200);
    expect(res.body.result?.customer?._id).not.toBe(String(victim._id));
  });

  it("login OTPs for an existing account are not the fixed code 1234", async () => {
    await fx.createCustomer({ name: "Victim", phone: "+919812345679", isVerified: true });
    await request(app).post("/api/customer/send-login-otp").send({ phone: "9812345679" });
    const res = await request(app).post("/api/customer/verify-otp").send({ phone: "9812345679", otp: "1234" });
    expect(res.status).not.toBe(200);
  });
});
