import Joi from "joi";
import { ALL_FEEDBACK_TAGS, RATING_STATUSES } from "../constants/deliveryRatingConstants.js";

const trimmedString = Joi.string().trim();

export const validateCreateRating = Joi.object({
  orderId: trimmedString.required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  feedbackTags: Joi.array()
    .items(trimmedString.valid(...ALL_FEEDBACK_TAGS))
    .optional(),
  comment: trimmedString.max(500).allow("").optional(),
});

export const validateModerationStatus = Joi.object({
  status: trimmedString
    .valid(...Object.values(RATING_STATUSES))
    .required(),
  reason: trimmedString.max(300).allow("").optional(),
});
