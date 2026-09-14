import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../app/models/product.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/turbocart";

async function runMigration() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected successfully.");

    console.log("Starting Product Return Policy migration...");

    const result = await Product.updateMany(
      {
        $or: [
          { returnPolicy: { $exists: false } },
          { "returnPolicy.isReturnable": { $exists: false } },
          { "returnPolicy.returnWindowDays": { $exists: false } },
          { "returnPolicy.returnReasons": { $exists: false } },
        ],
      },
      {
        $set: {
          returnPolicy: {
            isReturnable: false,
            returnWindowDays: 0,
            returnReasons: [],
          },
        },
      },
    );

    console.log(`Migration Completed. Updated ${result.modifiedCount} products.`);
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
