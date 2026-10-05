import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import Joi from "joi";

const mockSellerFindById = jest.fn();
jest.unstable_mockModule("../../../app/models/seller.js", () => ({
  default: { findById: mockSellerFindById },
}));

const { verifyToken, optionalVerifyToken, allowRoles, requireApprovedSeller } = await import(
  "../../../app/middleware/authMiddleware.js"
);
const { validate, validateBody, validateBodySafe } = await import("../../../app/middleware/validate.js");
const { errorHandler, notFoundHandler } = await import("../../../app/middleware/errorMiddleware.js");

const SECRET = "unit-test-secret";
const sign = (payload, opts = {}) => jwt.sign(payload, SECRET, { expiresIn: "1h", ...opts });

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

function sellerQuery(result) {
  return { select: () => ({ lean: () => Promise.resolve(result) }) };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/private", verifyToken, (req, res) => res.json({ user: req.user }));
  app.get("/optional", optionalVerifyToken, (req, res) => res.json({ user: req.user ?? null }));
  app.get("/admin", verifyToken, allowRoles("admin"), (req, res) => res.json({ ok: true }));
  app.get("/seller-ops", verifyToken, requireApprovedSeller, (req, res) => res.json({ ok: true }));
  app.post(
    "/validated",
    validate(Joi.object({ name: Joi.string().required(), qty: Joi.number().min(1) })),
    (req, res) => res.json(req.body),
  );
  app.get(
    "/query",
    validate(Joi.object({ page: Joi.number().integer().min(1).default(1) }), "query"),
    (req, res) => res.json(req.query),
  );
  app.get("/fail", (req, res, next) => {
    const err = new Error("Bad input");
    err.statusCode = 422;
    err.code = "BAD_INPUT";
    next(err);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("authMiddleware", () => {
  const app = buildApp();

  it("rejects missing token with 401", async () => {
    const res = await request(app).get("/private");
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Unauthorized, token missing");
  });

  it("rejects invalid and expired tokens", async () => {
    const bad = await request(app).get("/private").set("Authorization", "Bearer a.b.c");
    expect(bad.status).toBe(401);
    const expired = sign({ id: "1", role: "customer" }, { expiresIn: -10 });
    const res = await request(app).get("/private").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid or expired token");
  });

  it("accepts Bearer, raw and x-access-token headers", async () => {
    const token = sign({ id: "u1", role: "customer" });
    for (const [header, value] of [
      ["Authorization", `Bearer ${token}`],
      ["Authorization", token],
      ["x-access-token", token],
    ]) {
      const res = await request(app).get("/private").set(header, value);
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(expect.objectContaining({ id: "u1", role: "customer" }));
    }
  });

  it("optionalVerifyToken never blocks", async () => {
    const anon = await request(app).get("/optional");
    expect(anon.status).toBe(200);
    expect(anon.body.user).toBeNull();
    const invalid = await request(app).get("/optional").set("Authorization", "Bearer x.y.z");
    expect(invalid.status).toBe(200);
    expect(invalid.body.user).toBeNull();
    const valid = await request(app)
      .get("/optional")
      .set("Authorization", `Bearer ${sign({ id: "u2", role: "customer" })}`);
    expect(valid.body.user.id).toBe("u2");
  });

  it("allowRoles enforces role", async () => {
    const denied = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer ${sign({ id: "c", role: "customer" })}`);
    expect(denied.status).toBe(403);
    const allowed = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer ${sign({ id: "a", role: "admin" })}`);
    expect(allowed.status).toBe(200);
  });

  describe("requireApprovedSeller", () => {
    const sellerToken = `Bearer ${sign({ id: "s1", role: "seller" })}`;

    beforeEach(() => mockSellerFindById.mockReset());

    it("skips non-seller roles", async () => {
      const res = await request(app)
        .get("/seller-ops")
        .set("Authorization", `Bearer ${sign({ id: "a", role: "admin" })}`);
      expect(res.status).toBe(200);
      expect(mockSellerFindById).not.toHaveBeenCalled();
    });

    it("401 when seller is missing", async () => {
      mockSellerFindById.mockReturnValue(sellerQuery(null));
      const res = await request(app).get("/seller-ops").set("Authorization", sellerToken);
      expect(res.status).toBe(401);
    });

    it("403 pending when not verified", async () => {
      mockSellerFindById.mockReturnValue(sellerQuery({ isVerified: false, isActive: true }));
      const res = await request(app).get("/seller-ops").set("Authorization", sellerToken);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Seller account is pending admin approval.");
      expect(res.body.result.applicationStatus).toBe("pending");
    });

    it("403 rejected with reason", async () => {
      mockSellerFindById.mockReturnValue(
        sellerQuery({ isVerified: false, isActive: true, applicationStatus: "rejected", rejectionReason: "Docs" }),
      );
      const res = await request(app).get("/seller-ops").set("Authorization", sellerToken);
      expect(res.status).toBe(403);
      expect(res.body.result.rejectionReason).toBe("Docs");
    });

    it("passes approved active sellers", async () => {
      mockSellerFindById.mockReturnValue(
        sellerQuery({ isVerified: true, isActive: true, applicationStatus: "approved" }),
      );
      const res = await request(app).get("/seller-ops").set("Authorization", sellerToken);
      expect(res.status).toBe(200);
    });

    it("500 when lookup throws", async () => {
      mockSellerFindById.mockImplementation(() => {
        throw new Error("db down");
      });
      const res = await request(app).get("/seller-ops").set("Authorization", sellerToken);
      expect(res.status).toBe(500);
    });
  });
});

describe("validate middleware", () => {
  const app = buildApp();

  it("returns 400 with joined messages", async () => {
    const res = await request(app).post("/validated").send({ qty: 0 });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('"name" is required');
    expect(res.body.message).toContain('"qty" must be greater than or equal to 1');
  });

  it("strips unknown keys on success", async () => {
    const res = await request(app).post("/validated").send({ name: "x", qty: 2, hack: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "x", qty: 2 });
  });

  it("converts and defaults query strings", async () => {
    expect((await request(app).get("/query?page=3")).body).toEqual({ page: 3 });
    expect((await request(app).get("/query")).body).toEqual({ page: 1 });
    expect((await request(app).get("/query?page=0")).status).toBe(400);
  });

  it("rejects unsupported sources", () => {
    expect(() => validate(Joi.object(), "cookies")).toThrow(/unsupported source/);
  });

  it("validateBody throws 400 and validateBodySafe returns result", () => {
    const schema = Joi.object({ a: Joi.number().required() });
    expect(validateBody(schema, { a: 1, b: 2 })).toEqual({ a: 1 });
    try {
      validateBody(schema, {});
      throw new Error("should not reach");
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
    expect(validateBodySafe(schema, {})).toEqual({ isValid: false, message: '"a" is required' });
    expect(validateBodySafe(schema, { a: 1 })).toEqual({ isValid: true, value: { a: 1 } });
  });
});

describe("error middleware", () => {
  const app = buildApp();

  it("404 for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.result.code).toBe("ROUTE_NOT_FOUND");
  });

  it("propagates status, message and code", async () => {
    const res = await request(app).get("/fail");
    expect(res.status).toBe(422);
    expect(res.body).toEqual(
      expect.objectContaining({ success: false, message: "Bad input" }),
    );
    expect(res.body.result.code).toBe("BAD_INPUT");
  });
});
