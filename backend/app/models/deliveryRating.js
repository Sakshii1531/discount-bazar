import mongoose from "mongoose";
import {
  RATING_STATUSES,
  ALL_FEEDBACK_TAGS,
} from "../constants/deliveryRatingConstants.js";

const deliveryRatingSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    deliveryPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      index: true,
    },
    feedbackTags: [
      {
        type: String,
        enum: ALL_FEEDBACK_TAGS,
      },
    ],
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    status: {
      type: String,
      enum: Object.values(RATING_STATUSES),
      default: RATING_STATUSES.ACTIVE,
      index: true,
    },
    isFlagged: {
      type: Boolean,
      default: false,
    },
    flagReason: {
      type: String,
      default: "",
    },
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    moderatedAt: {
      type: Date,
      default: null,
    },
    moderationReason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Ensure a customer can only submit ONE delivery rating per order
deliveryRatingSchema.index({ orderId: 1, customerId: 1 }, { unique: true });
deliveryRatingSchema.index({ deliveryPartnerId: 1, status: 1, createdAt: -1 });

export default mongoose.models.DeliveryRating ||
  mongoose.model("DeliveryRating", deliveryRatingSchema);
