import mongoose from "mongoose";
import {
  RATING_STATUSES,
  ALL_PRODUCT_FEEDBACK_TAGS,
} from "../constants/productRatingConstants.js";

const productRatingSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: "{VALUE} is not an integer rating",
      },
      index: true,
    },
    feedbackTags: [
      {
        type: String,
        enum: ALL_PRODUCT_FEEDBACK_TAGS,
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
    isVerifiedPurchase: {
      type: Boolean,
      default: true,
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

// Database unique constraint: prevent duplicate ratings per orderItemId and customerId
productRatingSchema.index({ orderItemId: 1, customerId: 1 }, { unique: true });
productRatingSchema.index({ productId: 1, status: 1, createdAt: -1 });

export default mongoose.models.ProductRating ||
  mongoose.model("ProductRating", productRatingSchema);
