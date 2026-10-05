import { slugify } from "../../../app/utils/slugify.js";
import { normalizePhoneNumber, isValidE164Phone, maskPhone } from "../../../app/utils/phone.js";
import { escapeRegex, buildSearchRegex } from "../../../app/utils/regex.js";
import {
  normalizeMobile,
  toIndianNumber,
  getOtpLength,
  generateOTP as generateSmsOtp,
  buildMessage,
} from "../../../app/utils/smsHelpers.js";

describe("utils/slugify", () => {
  it("lowercases, trims and hyphenates", () => {
    expect(slugify("  Fresh Fruits & Veggies  ")).toBe("fresh-fruits-veggies");
  });

  it("collapses repeated hyphens and strips symbols", () => {
    expect(slugify("Dairy -- & Bakery!!")).toBe("dairy-bakery");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
  });

  it("handles numbers", () => {
    expect(slugify(123)).toBe("123");
  });
});

describe("utils/phone", () => {
  it("adds default +91 to 10-digit numbers", () => {
    expect(normalizePhoneNumber("98765 43210")).toBe("+919876543210");
  });

  it("converts 00 prefix to +", () => {
    expect(normalizePhoneNumber("00919876543210")).toBe("+919876543210");
  });

  it("strips punctuation", () => {
    expect(normalizePhoneNumber("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("returns empty string for empty input", () => {
    expect(normalizePhoneNumber(null)).toBe("");
    expect(normalizePhoneNumber("   ")).toBe("");
  });

  it("validates E.164 numbers", () => {
    expect(isValidE164Phone("+919876543210")).toBe(true);
    expect(isValidE164Phone("9876543210")).toBe(false);
    expect(isValidE164Phone("+0123456789")).toBe(false);
    expect(isValidE164Phone(undefined)).toBe(false);
  });

  it("masks phone numbers", () => {
    expect(maskPhone("+919876543210")).toBe("+91***10");
    expect(maskPhone("123")).toBe("***");
    expect(maskPhone(null)).toBe("***");
  });
});

describe("utils/regex", () => {
  it("escapes all regex special characters", () => {
    expect(escapeRegex("a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o")).toBe(
      "a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o",
    );
  });

  it("returns empty string for null", () => {
    expect(escapeRegex(null)).toBe("");
  });

  it("escaped output is safe to compile", () => {
    const input = "milk (1L) [promo]+";
    expect(() => new RegExp(escapeRegex(input))).not.toThrow();
    expect(new RegExp(escapeRegex(input)).test(input)).toBe(true);
  });

  it("builds anchored case-insensitive search regex by default", () => {
    expect(buildSearchRegex("mi.lk")).toEqual({ $regex: "^mi\\.lk", $options: "i" });
  });

  it("supports unanchored and case-sensitive options", () => {
    expect(buildSearchRegex("milk", { anchored: false, caseInsensitive: false })).toEqual({
      $regex: "milk",
    });
  });
});

describe("utils/smsHelpers", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("normalizes mobiles to last 10 digits", () => {
    expect(normalizeMobile("+91 98765-43210")).toBe("9876543210");
    expect(normalizeMobile(null)).toBe("");
  });

  it("formats Indian numbers with 91 prefix", () => {
    expect(toIndianNumber("9876543210")).toBe("919876543210");
    expect(toIndianNumber("")).toBe("");
  });

  it("reads OTP length from env with minimum of 4", () => {
    delete process.env.OTP_LENGTH;
    expect(getOtpLength()).toBe(4);
    process.env.OTP_LENGTH = "6";
    expect(getOtpLength()).toBe(6);
    process.env.OTP_LENGTH = "2";
    expect(getOtpLength()).toBe(4);
  });

  it("generates numeric OTPs of requested length", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateSmsOtp(6)).toMatch(/^\d{6}$/);
    }
    expect(generateSmsOtp(2)).toMatch(/^\d{4}$/);
  });

  it("builds message from default template", () => {
    delete process.env.SMS_INDIA_HUB_TEMPLATE_TEXT;
    process.env.OTP_EXPIRY_MINUTES = "10";
    expect(buildMessage("1234")).toBe("Your OTP is 1234. Valid for 10 minutes.");
  });

  it("replaces DLT ##var## placeholders in app/otp/minutes order", () => {
    process.env.SMS_INDIA_HUB_TEMPLATE_TEXT = "Welcome to ##var##. OTP ##var## valid ##var## min";
    process.env.APP_NAME = "DiscountBazar";
    process.env.OTP_EXPIRY_MINUTES = "5";
    expect(buildMessage("4321")).toBe("Welcome to DiscountBazar. OTP 4321 valid 5 min");
  });
});
