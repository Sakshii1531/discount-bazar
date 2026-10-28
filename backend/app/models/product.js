import mongoose from "mongoose";
import { isBlankSku, makeProductSku } from "../utils/sku.js";

const productSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        sku: {
            type: String,
            unique: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        price: {
            type: Number,
            required: true,
            min: 0,
        },
        salePrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        stock: {
            type: Number,
            required: true,
            default: 0,
        },
        lowStockAlert: {
            type: Number,
            default: 5,
        },
        // Name copy of the linked Brand (kept in sync by the brand controller)
        // so existing brand filters keep working on a plain string.
        brand: {
            type: String,
            trim: true,
        },
        brandId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Brand",
            default: null,
            index: true,
        },
        // Item master
        barcode: { type: String, trim: true, index: true, sparse: true },
        size: { type: String, trim: true, default: "" },
        colour: { type: String, trim: true, default: "" },
        mrp: { type: Number, min: 0, default: 0 },
        purchaseCost: { type: Number, min: 0, default: 0 },
        gstPercent: { type: Number, min: 0, max: 100, default: 0 },
        // Whether purchaseCost already includes GST (at gstPercent). Existing
        // products default to EXCLUSIVE — how purchase bills already treat cost.
        purchaseGstType: { type: String, enum: ["INCLUSIVE", "EXCLUSIVE"], default: "EXCLUSIVE" },
        // Server-computed from purchaseCost + gstPercent + purchaseGstType (never client-set)
        purchaseBasePrice: { type: Number, min: 0, default: 0 },
        purchaseGstAmount: { type: Number, min: 0, default: 0 },
        purchaseFinalPrice: { type: Number, min: 0, default: 0 },
        // Seller's extra delivery fee (₹) and time (whole minutes) for this product,
        // added on top of the admin's global values (see deliveryQuoteService).
        productDeliveryFee: { type: Number, min: 0, default: 0 },
        productDeliveryTimeMinutes: {
            type: Number,
            min: 0,
            default: 0,
            validate: { validator: Number.isInteger, message: "Delivery time must be whole minutes" },
        },
        expiryDate: { type: Date, default: null },
        weight: {
            type: String,
            trim: true,
        },
        shelfLife: {
            type: String,
            trim: true,
            default: "",
        },
        countryOfOrigin: {
            type: String,
            trim: true,
            default: "",
        },
        fssaiLicense: {
            type: String,
            trim: true,
            default: "",
        },
        tags: [{
            type: String,
            trim: true,
        }],
        mainImage: {
            type: String, // Cloudinary URL
        },
        galleryImages: {
            type: [{ type: String }], // Cloudinary URLs, max 4
            validate: {
                validator: (v) => !v || v.length <= 4,
                message: "Gallery supports at most 4 images",
            },
        },
        headerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: true,
        },
        categoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: true,
        },
        subcategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: true,
        },
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Seller",
            required: true,
        },
        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active",
        },
        approvalStatus: {
            type: String,
            enum: ["pending", "approved", "rejected", "draft"],
            default: "approved",
        },
        approvalRequestedAt: {
            type: Date,
            default: null,
        },
        approvalReviewedAt: {
            type: Date,
            default: null,
        },
        approvalReviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
            default: null,
        },
        approvalNote: {
            type: String,
            trim: true,
            default: "",
        },
        lastSubmittedByRole: {
            type: String,
            enum: ["seller", "admin"],
            default: null,
        },
        variants: [
            {
                name: String,
                size: { type: String, trim: true },
                colour: { type: String, trim: true },
                price: Number,
                salePrice: Number,
                stock: Number,
                sku: String,
                barcode: { type: String, trim: true },
                purchaseCost: { type: Number, min: 0 },
                // Own expiry for this variant; null falls back to the product's expiryDate
                expiryDate: { type: Date, default: null },
                // Server-computed purchase GST breakdown for this variant's purchaseCost
                purchaseBasePrice: { type: Number, min: 0 },
                purchaseGstAmount: { type: Number, min: 0 },
                purchaseFinalPrice: { type: Number, min: 0 },
            }
        ],
        isFeatured: {
            type: Boolean,
            default: false,
        },
        returnPolicy: {
            isReturnable: {
                type: Boolean,
                default: false,
            },
            returnWindowDays: {
                type: Number,
                default: 0,
                min: 0,
                max: 30,
            },
            returnReasons: [{
                type: String,
                trim: true,
            }],
        },
        ratingAverage: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
        },
        ratingCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        ratingSum: {
            type: Number,
            default: 0,
            min: 0,
        },
        ratingDistribution: {
            1: { type: Number, default: 0 },
            2: { type: Number, default: 0 },
            3: { type: Number, default: 0 },
            4: { type: Number, default: 0 },
            5: { type: Number, default: 0 },
        },
    },
    { timestamps: true }
);

// Optimize performance for common queries on home/search pages
productSchema.index({ status: 1, isFeatured: 1, createdAt: -1 });
productSchema.index({ status: 1, createdAt: -1, _id: -1 });
productSchema.index({ approvalStatus: 1, status: 1, createdAt: -1 });
productSchema.index({ headerId: 1, status: 1 });
productSchema.index({ categoryId: 1, status: 1 });
productSchema.index({ subcategoryId: 1, status: 1 });
productSchema.index({ sellerId: 1, status: 1 });
productSchema.index({ sellerId: 1, approvalStatus: 1, createdAt: -1 });
productSchema.index({ sellerId: 1, createdAt: -1, _id: -1 });
productSchema.index({ "returnPolicy.isReturnable": 1, sellerId: 1, status: 1 });
productSchema.index({ name: "text", tags: "text" }); // For better search if regex is too slow

// Stock, purchase bills and POS lines find a variant by SKU, so every save
// (seeds, imports, scripts, not only the product controller) gives a blank
// variant one. Existing SKUs are left exactly as stored.
productSchema.pre("validate", function fillBlankVariantSkus() {
    const variants = this.variants || [];
    if (!variants.some((v) => isBlankSku(v?.sku))) return;
    const taken = new Set(variants.filter((v) => !isBlankSku(v?.sku)).map((v) => String(v.sku).trim().toUpperCase()));
    for (const variant of variants) {
        if (isBlankSku(variant?.sku)) variant.sku = makeProductSku(this.name, taken);
    }
});

export default mongoose.model("Product", productSchema);
