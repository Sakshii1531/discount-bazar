import { asRetryLaterError, isTransientTransactionError } from "../../../app/utils/transactionRetry.js";

describe("isTransientTransactionError", () => {
  it("recognises MongoDB's TransientTransactionError label", () => {
    expect(isTransientTransactionError({ hasErrorLabel: (l) => l === "TransientTransactionError" })).toBe(true);
    expect(isTransientTransactionError({ errorLabels: ["TransientTransactionError"] })).toBe(true);
  });

  it("recognises write conflicts and 'catalog changes' snapshot errors", () => {
    expect(isTransientTransactionError({ code: 112 })).toBe(true);
    expect(isTransientTransactionError({ code: 246 })).toBe(true);
  });

  it("leaves ordinary failures alone", () => {
    expect(isTransientTransactionError(null)).toBe(false);
    expect(isTransientTransactionError({ code: 11000 })).toBe(false);
    expect(isTransientTransactionError(Object.assign(new Error("Insufficient stock"), { statusCode: 400 }))).toBe(false);
  });

  it("turns an exhausted retry into a retryable 503", () => {
    const err = asRetryLaterError(new Error("Unable to write to collection due to catalog changes"));
    expect(err.statusCode).toBe(503);
  });
});
