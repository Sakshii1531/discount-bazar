import mongoose from "mongoose";

/**
 * Admin-managed list of official brands. Products link to a brand through
 * `Product.brandId`; `Product.brand` keeps a copy of the brand name so the
 * customer app's existing brand filters and listings keep working.
 */
const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
      maxlength: 100,
    },
    // Lower-cased, whitespace-collapsed name. Unique so "Amul" and " amul "
    // cannot both exist.
    nameKey: {
      type: String,
      required: true,
      unique: true,
    },
    slug: {
      type: String,
      required: [true, "URL slug is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    logo: {
      type: String, // Cloudinary URL
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true },
);

export function toBrandNameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

brandSchema.pre("validate", function setNameKey(next) {
  if (this.isModified("name") || !this.nameKey) {
    this.name = String(this.name || "").trim().replace(/\s+/g, " ");
    this.nameKey = toBrandNameKey(this.name);
  }
  next();
});

brandSchema.index({ status: 1, name: 1 });

export default mongoose.model("Brand", brandSchema);
