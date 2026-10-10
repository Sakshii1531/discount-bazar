import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import Category from "../app/models/category.js";
import Product from "../app/models/product.js";
import Seller from "../app/models/seller.js";

async function seed() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is missing in .env");
  }

  console.log("Connecting to MongoDB with 20s timeout...");
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 45000,
  });
  console.log("Connected to MongoDB successfully!");

  // 1. Find Seller
  const seller = await Seller.findOne({ email: /seller123@gmail\.com/i });
  if (!seller) {
    throw new Error("Seller seller123@gmail.com not found in database!");
  }
  console.log(`Using seller: ${seller.email} (ID: ${seller._id})`);

  // 2. Find Header Category: "Grocery & Staples"
  let header = await Category.findOne({
    type: "header",
    name: { $regex: /grocery/i },
  });
  if (!header) {
    header = await Category.findOne({ type: "header" });
  }
  console.log(`Using Header Category: ${header?.name} (ID: ${header?._id})`);

  // 3. Find or Create Main Category: "Oil & Ghee" or "Oil, Ghee & Masala"
  let mainCategory = await Category.findOne({
    type: "category",
    name: { $regex: /oil/i },
  });
  if (!mainCategory) {
    mainCategory = await Category.create({
      name: "Oil, Ghee & Masala",
      slug: "oil-ghee-masala",
      type: "category",
      parentId: header._id,
      status: "active",
    });
  }
  console.log(`Using Main Category: ${mainCategory.name} (ID: ${mainCategory._id})`);

  // 4. Ensure Subcategory: "Oil"
  let subcatOil = await Category.findOne({
    type: "subcategory",
    parentId: mainCategory._id,
    name: { $regex: /^oil$/i },
  });
  if (!subcatOil) {
    subcatOil = await Category.findOne({
      type: "subcategory",
      parentId: mainCategory._id,
      name: { $regex: /oil/i },
    });
  }
  if (!subcatOil) {
    subcatOil = await Category.create({
      name: "Oil",
      slug: "oil",
      type: "subcategory",
      parentId: mainCategory._id,
      status: "active",
    });
  }
  console.log(`Using Subcategory (Oil): ${subcatOil.name} (ID: ${subcatOil._id})`);

  // 5. Ensure Subcategory: "Desi Ghee"
  let subcatGhee = await Category.findOne({
    type: "subcategory",
    parentId: mainCategory._id,
    name: { $regex: /ghee/i },
  });
  if (!subcatGhee) {
    subcatGhee = await Category.create({
      name: "Desi Ghee",
      slug: "desi-ghee",
      type: "subcategory",
      parentId: mainCategory._id,
      status: "active",
    });
  }
  console.log(`Using Subcategory (Desi Ghee): ${subcatGhee.name} (ID: ${subcatGhee._id})`);

  // Sample image URLs (high quality grocery images)
  const defaultImages = {
    mustardOil: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&auto=format&fit=crop&q=80",
    refinedOil: "https://images.unsplash.com/photo-1546548970-71785318a17b?w=600&auto=format&fit=crop&q=80",
    ghee: "https://images.unsplash.com/photo-1589927986089-35812388d1f4?w=600&auto=format&fit=crop&q=80",
  };

  const productsData = [
    {
      name: "Fortune Premium Kachi Ghani Mustard Oil",
      slug: "fortune-premium-kachi-ghani-mustard-oil",
      sku: "SKU-FORTUNE-MUSTARD-910G",
      brand: "Fortune",
      category: mainCategory._id,
      subcategory: subcatOil._id,
      price: 198,
      mrp: 230,
      salePrice: 198,
      stock: 50,
      weight: "910 g",
      shelfLife: "12 months",
      countryOfOrigin: "India",
      tags: ["mustard oil", "cooking oil", "kachi ghani", "edible oil"],
      mainImage: defaultImages.mustardOil,
      description: "Fortune Premium Kachi Ghani Pure Mustard Oil packed with authentic taste and pungent aroma.",
    },
    {
      name: "Fortune Soya Health Refined Oil",
      slug: "fortune-soya-health-refined-oil",
      sku: "SKU-FORTUNE-SOYA-1L",
      brand: "Fortune",
      category: mainCategory._id,
      subcategory: subcatOil._id,
      price: 140,
      mrp: 170,
      salePrice: 140,
      stock: 50,
      weight: "1 L",
      shelfLife: "9 months",
      countryOfOrigin: "India",
      tags: ["refined oil", "cooking oil", "soya oil", "edible oil"],
      mainImage: defaultImages.refinedOil,
      description: "Fortune Plus Soya Health Refined Soyabean Oil fortified with Vitamin A & Vitamin D.",
    },
    {
      name: "Pansari Kacchi Ghani Pure Mustard Oil",
      slug: "pansari-kacchi-ghani-pure-mustard-oil",
      sku: "SKU-PANSARI-MUSTARD-1L",
      brand: "Pansari",
      category: mainCategory._id,
      subcategory: subcatOil._id,
      price: 193,
      mrp: 245,
      salePrice: 193,
      stock: 50,
      weight: "1 L",
      shelfLife: "12 months",
      countryOfOrigin: "India",
      tags: ["mustard oil", "cooking oil", "kachi ghani", "edible oil"],
      mainImage: defaultImages.mustardOil,
      description: "Pansari Kacchi Ghani Pure Mustard Oil traditionally cold pressed for authentic flavor.",
    },
    {
      name: "Amul Pure Desi Ghee",
      slug: "amul-pure-desi-ghee-1l",
      sku: "SKU-AMUL-GHEE-1L",
      brand: "Amul",
      category: mainCategory._id,
      subcategory: subcatGhee._id,
      price: 550,
      mrp: 610,
      salePrice: 550,
      stock: 30,
      weight: "1 L",
      shelfLife: "9 months",
      countryOfOrigin: "India",
      tags: ["desi ghee", "ghee", "pure ghee", "dairy"],
      mainImage: defaultImages.ghee,
      description: "Amul Pure Ghee made from fresh cream with rich traditional aroma and granular texture.",
    },
  ];

  for (const item of productsData) {
    const existing = await Product.findOne({ slug: item.slug });
    const productPayload = {
      ...item,
      headerId: header._id,
      categoryId: item.category,
      subcategoryId: item.subcategory,
      sellerId: seller._id,
      status: "active",
      approvalStatus: "approved",
      productDeliveryFee: 0,
      productDeliveryTimeMinutes: 10,
      ratingAverage: 4.8,
      ratingCount: 154,
    };

    if (existing) {
      await Product.findByIdAndUpdate(existing._id, productPayload);
      console.log(`Updated existing product: ${item.name} (${existing._id})`);
    } else {
      const created = await Product.create(productPayload);
      console.log(`Created new product: ${item.name} (${created._id})`);
    }
  }

  console.log("Seeding completed successfully!");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
