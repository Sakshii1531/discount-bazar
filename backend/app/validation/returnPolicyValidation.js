import Joi from "joi";
import { ALLOWED_RETURN_REASONS } from "../utils/returnEligibilityHelper.js";

export const returnPolicyJoiSchema = Joi.object({
  isReturnable: Joi.boolean().required().messages({
    "boolean.base": "isReturnable must be a boolean (true or false)",
    "any.required": "isReturnable is required",
  }),
  returnWindowDays: Joi.number().when("isReturnable", {
    is: true,
    then: Joi.number().integer().min(1).max(30).required().messages({
      "number.base": "returnWindowDays must be a valid integer number",
      "number.integer": "returnWindowDays must be a whole number (no decimals)",
      "number.min": "returnWindowDays must be at least 1 day",
      "number.max": "returnWindowDays cannot exceed 30 days",
      "any.required": "returnWindowDays is mandatory when product is returnable",
    }),
    otherwise: Joi.number().valid(0).default(0).messages({
      "any.only": "returnWindowDays must be 0 when product is non-returnable",
    }),
  }),
  returnReasons: Joi.array()
    .items(Joi.string().valid(...ALLOWED_RETURN_REASONS))
    .default([...ALLOWED_RETURN_REASONS]),
});

export const returnRequestJoiSchema = Joi.object({
  itemId: Joi.string().required(),
  reason: Joi.string().trim().valid(...ALLOWED_RETURN_REASONS).required().messages({
    "any.only": "Invalid return reason",
    "any.required": "Return reason is required",
  }),
  comments: Joi.string().trim().max(500).allow("", null).optional(),
});

export function parseAndValidateReturnPolicy(input) {
  let policy = input;
  if (typeof policy === "string") {
    const trimmed = policy.trim();
    if (trimmed.startsWith("{")) {
      try {
        policy = JSON.parse(trimmed);
      } catch {
        policy = null;
      }
    }
  }

  if (policy === null || policy === undefined) {
    return {
      value: { isReturnable: false, returnWindowDays: 0, returnReasons: [] },
      error: null,
    };
  }

  if (typeof policy !== "object") {
    return {
      value: null,
      error: "returnPolicy must be an object",
    };
  }

  const rawPolicy = { ...policy };
  if (typeof rawPolicy.isReturnable === "string") {
    if (rawPolicy.isReturnable.toLowerCase() === "true") rawPolicy.isReturnable = true;
    else if (rawPolicy.isReturnable.toLowerCase() === "false") rawPolicy.isReturnable = false;
  }
  if (rawPolicy.isReturnable && (!Array.isArray(rawPolicy.returnReasons) || rawPolicy.returnReasons.length === 0)) {
    rawPolicy.returnReasons = [...ALLOWED_RETURN_REASONS];
  }

  const { value, error } = returnPolicyJoiSchema.validate(rawPolicy, { convert: true });
  if (error) {
    return { value: null, error: error.details[0]?.message || "Invalid return policy" };
  }
  return { value, error: null };
}
