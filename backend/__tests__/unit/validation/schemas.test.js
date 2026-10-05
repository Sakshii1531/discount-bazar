/**
 * Table-driven unit tests for every Joi validation module, grouped by
 * app section. Each case lists one valid payload and the invalid payloads
 * that must be rejected.
 */
import * as adminAuth from "../../../app/validation/adminAuthValidation.js";
import * as cart from "../../../app/validation/cartValidation.js";
import * as customerAuth from "../../../app/validation/customerAuthValidation.js";
import * as customer from "../../../app/validation/customerValidation.js";
import * as deliveryRating from "../../../app/validation/deliveryRatingValidation.js";
import * as delivery from "../../../app/validation/deliveryValidation.js";
import * as finance from "../../../app/validation/financeValidation.js";
import * as maps from "../../../app/validation/mapsValidation.js";
import * as order from "../../../app/validation/orderValidation.js";
import * as payment from "../../../app/validation/paymentValidation.js";
import * as pos from "../../../app/validation/posValidation.js";
import * as product from "../../../app/validation/productValidation.js";
import * as returnPolicy from "../../../app/validation/returnPolicyValidation.js";
import * as seller from "../../../app/validation/sellerValidation.js";
import * as ticket from "../../../app/validation/ticketValidation.js";
import * as wallet from "../../../app/validation/walletValidation.js";
import * as wishlist from "../../../app/validation/wishlistValidation.js";
import { ALL_FEEDBACK_TAGS, RATING_STATUSES } from "../../../app/constants/deliveryRatingConstants.js";

const OID = "64b7f0c2a1b2c3d4e5f60718";
const OPTS = { abortEarly: false, stripUnknown: true };

const posItem = { productId: OID, quantity: 2, price: 50 };

const cases = {
  "admin auth": [
    [adminAuth.bootstrapAdminSchema,
      { name: "Admin", email: "ADMIN@Example.com", password: "Str0ngPassword" },
      [{ name: "Admin", email: "admin@example.com", password: "weakpass" },
        { name: "A", email: "admin@example.com", password: "Str0ngPassword" },
        { name: "Admin", email: "not-an-email", password: "Str0ngPassword" }]],
    [adminAuth.loginAdminSchema,
      { email: "admin@example.com", password: "x" },
      [{ email: "admin@example.com" }, { password: "x" }]],
  ],
  "customer auth": [
    [customerAuth.sendSignupOtpSchema, { name: "Ravi", phone: "9876543210" },
      [{ name: "R", phone: "9876543210" }, { name: "Ravi" }]],
    [customerAuth.sendLoginOtpSchema, { phone: "9876543210" }, [{ phone: "123" }, {}]],
    [customerAuth.verifyOtpSchema, { phone: "9876543210", otp: "1234" },
      [{ phone: "9876543210", otp: "12" }, { phone: "9876543210", otp: "abcd" }]],
  ],
  customer: [
    [customer.updateProfileSchema, { name: "Ravi", email: "r@x.com", gender: "male" },
      [{ gender: "robot" }, { email: "bad" }, { avatarUrl: "not a url" }]],
    [customer.addAddressSchema,
      { name: "Ravi", phone: "+919876543210", address: "12 MG Road", pincode: "452001",
        location: { coordinates: [75.85, 22.71] } },
      [{ name: "Ravi", phone: "12", address: "12 MG Road" },
        { name: "Ravi", phone: "9876543210" },
        { name: "Ravi", phone: "9876543210", address: "x y", pincode: "ab" },
        { name: "Ravi", phone: "9876543210", address: "x y", location: { coordinates: [500, 22] } }]],
    [customer.updateAddressSchema, { city: "Indore" }, [{ phone: "abc" }]],
    [customer.wishlistToggleSchema, { productId: OID }, [{}, { productId: "short" }]],
    [customer.submitReviewSchema, { productId: OID, rating: 5, comment: "Great" },
      [{ productId: OID, rating: 6 }, { productId: OID, rating: 0 }, { productId: OID }]],
  ],
  cart: [
    [cart.addToCartSchema, { productId: OID, quantity: 1 },
      [{ productId: OID, quantity: 0 }, { productId: OID, quantity: 100 }, { quantity: 1 }]],
    [cart.updateCartItemSchema, { productId: OID, quantity: 0 }, [{ productId: OID, quantity: -1 }]],
    [cart.removeCartItemQuerySchema, { variantSku: "" }, [{ variantSku: "x".repeat(65) }]],
    [cart.mergeCartSchema, { items: [{ productId: OID, quantity: 2 }] },
      [{ items: [] }, {}, { items: [{ productId: OID }] }]],
    [cart.replaceCartSchema, { productId: OID, quantity: 3, variantSku: "500g" }, [{ productId: OID }]],
  ],
  wishlist: [
    [wishlist.addToWishlistSchema, { productId: OID }, [{}]],
    [wishlist.toggleWishlistSchema, { productId: OID }, [{ productId: "" }]],
    [wishlist.removeFromWishlistParamsSchema, { productId: OID }, [{ productId: "1" }]],
  ],
  orders: [
    [order.placeOrderSchema, { addressId: "a1", paymentMode: "COD" },
      [{ addressId: "a1", paymentMode: "CASH" }, { paymentMode: "COD" }]],
    [order.cancelOrderSchema, { reason: "Changed mind" }, [{}, { reason: "" }]],
    [order.updateOrderStatusSchema, { status: "packed" }, [{ status: "shipped" }]],
    [order.requestReturnSchema, { items: [{ itemIndex: 0, quantity: 1 }], reason: "Damaged" },
      [{ items: [], reason: "x" }, { items: [{ itemIndex: -1, quantity: 1 }], reason: "x" }]],
    [order.rejectReturnSchema, { reason: "No" }, [{}]],
    [order.updateReturnQcSchema, { qcStatus: "passed" }, [{ qcStatus: "maybe" }]],
    [order.assignReturnDeliverySchema, {}, [{ deliveryBoyId: 5 }]],
    [order.skipOrderSchema, { reason: "Too far" }, [{ reason: "x".repeat(501) }]],
  ],
  payments: [
    [payment.createPaymentOrderSchema, { orderId: "ORD12345678" }, [{}, { orderId: "short" }]],
    [payment.verifyPaymentClientSchema, { orderRef: OID, merchantOrderId: "M1" },
      [{ orderRef: OID }, { merchantOrderId: "M1" }]],
    [payment.refundSchema, { merchantOrderId: "M1", amount: 10 }, [{ merchantOrderId: "M1", amount: 0 }]],
  ],
  finance: [
    [finance.checkoutPreviewSchema,
      { items: [{ productId: OID, quantity: 1 }], address: { location: { lat: 22.7, lng: 75.8 } } },
      [{ items: [], address: {} }, { items: [{ quantity: 1 }], address: {} },
        { items: [{ productId: OID, quantity: 1 }], address: {}, paymentMode: "UPI" }]],
    [finance.createFinanceOrderSchema, { address: {}, paymentMode: "ONLINE" }, [{ address: {} }]],
    [finance.verifyOnlinePaymentSchema, { merchantOrderId: "M1" }, [{}]],
    [finance.codMarkCollectedSchema, { amount: 10 }, [{ amount: 0 }]],
    [finance.codReconcileSchema, { amount: 1 }, [{}]],
    [finance.financeLedgerQuerySchema, { page: 1, limit: 200 }, [{ limit: 201 }, { page: 0 }]],
    [finance.payoutProcessSchema, { payoutType: "SELLER" }, [{ payoutType: "BANK" }]],
    [finance.updateDeliverySettingsSchema, { codEnabled: true },
      [{}, { globalTaxRate: 101 }, { handlingFeeStrategy: "random" }]],
  ],
  maps: [
    [maps.geocodeQuerySchema, { address: "MG Road Indore" }, [{}, { country: "IND", address: "abc" }]],
    [maps.reverseGeocodeQuerySchema, { lat: 22.7, lng: 75.8 }, [{ lat: 91, lng: 0 }, { lat: 0 }]],
    [maps.routeRequestSchema,
      { origin: { lat: 1, lng: 1 }, destination: { lat: 2, lng: 2 }, mode: "driving" },
      [{ origin: { lat: 1, lng: 1 } }, { origin: { lat: 1, lng: 1 }, destination: { lat: 2, lng: 2 }, mode: "fly" }]],
  ],
  seller: [
    [seller.sellerSignupSchema,
      { name: "Shop Owner", email: "s@x.com", password: "password1", phone: "9876543210", shopName: "My Shop" },
      [{ name: "Shop Owner", email: "s@x.com", password: "short", phone: "9876543210", shopName: "My Shop" },
        { name: "Shop Owner", email: "s@x.com", password: "password1", phone: "12", shopName: "My Shop" }]],
    [seller.sellerLoginSchema, { email: "s@x.com", password: "p" }, [{ email: "s@x.com" }]],
    [seller.sellerProfileUpdateSchema, { serviceRadius: 10 }, [{ serviceRadius: 101 }]],
    [seller.sellerPasswordChangeSchema, { currentPassword: "a", newPassword: "newpassword" },
      [{ currentPassword: "a", newPassword: "short" }]],
    [seller.withdrawalRequestSchema, { amount: 100 }, [{ amount: 0 }]],
    [seller.sellerOnboardingSchema,
      { shopName: "Shop", address: "Main road", phone: "9876543210",
        bankAccount: { accountNumber: "123456789", ifsc: "SBIN0001234", accountHolderName: "Ravi" } },
      [{ shopName: "Shop", address: "Main road", phone: "9876543210",
        bankAccount: { accountNumber: "123", ifsc: "SBIN0001234", accountHolderName: "Ravi" } },
        { shopName: "Shop", address: "Main road", phone: "9876543210",
          bankAccount: { accountNumber: "123456789", ifsc: "sbin1234", accountHolderName: "Ravi" } }]],
  ],
  products: [
    [product.createProductSchema, { name: "Milk", price: 30, stock: 10, category: OID },
      [{ name: "Milk", price: -1, stock: 10, category: OID }, { price: 30, stock: 10, category: OID },
        { name: "Milk", price: 30, stock: 1.5, category: OID }]],
    [product.updateProductSchema, { price: 25 }, [{ stock: -1 }]],
    [product.updateStockSchema, { stock: 0 }, [{}, { stock: -5 }]],
  ],
  "return policy": [
    [returnPolicy.returnPolicyJoiSchema, { isReturnable: true, returnWindowDays: 7 },
      [{ isReturnable: true }, { isReturnable: true, returnWindowDays: 31 },
        { isReturnable: false, returnWindowDays: 5 }]],
    [returnPolicy.returnRequestJoiSchema, { itemId: "i1", reason: "Damaged Product" },
      [{ itemId: "i1", reason: "Just because" }]],
  ],
  pos: [
    [pos.createPosSaleSchema, { items: [posItem], posPaymentMethod: "CASH" },
      [{ items: [posItem], posPaymentMethod: "SPLIT" },
        { items: [posItem], posPaymentMethod: "CASH", posPayments: [{ method: "CASH", amount: 1 }, { method: "QR", amount: 1 }] },
        { items: [], posPaymentMethod: "CASH" }]],
    [pos.previewPosSaleSchema, { items: [posItem], taxPercent: 5 }, [{ items: [posItem], taxPercent: 150 }]],
    [pos.editPosSaleSchema, { items: [posItem] }, [{}]],
    [pos.createPosReturnSchema,
      { orderId: "POS1", items: [{ productId: OID, quantity: 1, condition: "good" }], refundMethod: "CASH" },
      [{ orderId: "POS1", items: [{ productId: OID, quantity: 1, condition: "broken" }], refundMethod: "CASH" }]],
  ],
  delivery: [
    [delivery.updateLocationSchema, { lat: 22.7, lng: 75.8, heading: 90 },
      [{ lat: 22.7 }, { lat: 22.7, lng: 75.8, heading: 361 }]],
    [delivery.goOnlineSchema, { lat: 1, lng: 1 }, [{ foo: "bar" }]],
    [delivery.completeDeliverySchema, { otp: "123456" }, [{ otp: "1234" }, { otp: "abcdef" }]],
    [delivery.submitCodCashSchema, { amount: 0 }, [{ amount: -1 }]],
    [delivery.withdrawalRequestSchema, { amount: 1 }, [{ amount: 0.5 }]],
    [delivery.updateProfileSchema, { vehicleType: "bike" }, [{ vehicleType: "truck" }]],
  ],
  "delivery ratings": [
    [deliveryRating.validateCreateRating,
      { orderId: "ORD1", rating: 4, feedbackTags: ALL_FEEDBACK_TAGS.slice(0, 1) },
      [{ orderId: "ORD1", rating: 6 }, { orderId: "ORD1", rating: 4, feedbackTags: ["__not_a_tag__"] }]],
    [deliveryRating.validateModerationStatus, { status: Object.values(RATING_STATUSES)[0] },
      [{ status: "__nope__" }]],
  ],
  support: [
    [ticket.createTicketSchema, { subject: "Late order", description: "My order is late", priority: "high" },
      [{ subject: "x", description: "ok ok" }, { subject: "ok", description: "ok", priority: "p0" }]],
    [ticket.addTicketMessageSchema, { text: "Hello" }, [{}]],
    [ticket.updateTicketStatusSchema, { status: "resolved" }, [{ status: "done" }]],
  ],
  wallet: [
    [wallet.creditWalletSchema, { ownerType: "SELLER", ownerId: OID, amount: 10, reason: "Bonus" },
      [{ ownerType: "ADMIN", ownerId: OID, amount: 10, reason: "x" },
        { ownerType: "SELLER", ownerId: OID, amount: 0, reason: "x" }]],
    [wallet.withdrawalCreateSchema, { amount: 50, upiId: "a@upi" }, [{ amount: 0 }]],
    [wallet.withdrawalActionSchema, { withdrawalId: OID, action: "approve" }, [{ withdrawalId: OID, action: "delete" }]],
    [wallet.codSubmissionSchema, { amount: 100 }, [{}]],
  ],
};

describe.each(Object.entries(cases))("validation: %s", (_section, schemaCases) => {
  it.each(schemaCases.map((c, i) => [i, ...c]))(
    "schema #%i accepts valid and rejects invalid payloads",
    (_i, schema, valid, invalids) => {
      const ok = schema.validate(valid, OPTS);
      expect(ok.error).toBeUndefined();
      for (const bad of invalids) {
        const result = schema.validate(bad, OPTS);
        expect(result.error).toBeDefined();
      }
    },
  );
});

describe("validation helpers", () => {
  it("adminAuth.validateSchema normalizes and strips unknown", () => {
    const value = adminAuth.validateSchema(adminAuth.loginAdminSchema, {
      email: " ADMIN@X.COM ",
      password: "p",
      extra: true,
    });
    expect(value).toEqual({ email: "admin@x.com", password: "p" });
  });

  it.each([adminAuth, customerAuth, payment])("validateSchema throws 400 errors (%#)", (mod) => {
    const schema = mod.loginAdminSchema || mod.sendLoginOtpSchema || mod.refundSchema;
    expect(() => mod.validateSchema(schema, {})).toThrow();
    try {
      mod.validateSchema(schema, {});
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });

  describe("parseAndValidateReturnPolicy", () => {
    it("defaults to non-returnable when missing", () => {
      expect(returnPolicy.parseAndValidateReturnPolicy(undefined)).toEqual({
        value: { isReturnable: false, returnWindowDays: 0, returnReasons: [] },
        error: null,
      });
    });

    it("parses JSON strings and string booleans", () => {
      const { value, error } = returnPolicy.parseAndValidateReturnPolicy(
        '{"isReturnable":"true","returnWindowDays":"7"}',
      );
      expect(error).toBeNull();
      expect(value.isReturnable).toBe(true);
      expect(value.returnWindowDays).toBe(7);
      expect(value.returnReasons.length).toBeGreaterThan(0);
    });

    it("rejects non-object policies", () => {
      expect(returnPolicy.parseAndValidateReturnPolicy(42).error).toBe("returnPolicy must be an object");
    });

    it("returns a readable error for invalid windows", () => {
      const { error } = returnPolicy.parseAndValidateReturnPolicy({ isReturnable: true, returnWindowDays: 45 });
      expect(error).toBe("returnWindowDays cannot exceed 30 days");
    });
  });
});
