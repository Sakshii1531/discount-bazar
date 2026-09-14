import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quickcommerce";

const sellerSchema = new mongoose.Schema({}, { strict: false });
const Seller = mongoose.model('Seller', sellerSchema);

async function main() {
  await mongoose.connect(uri);
  const byEmail = await Seller.findOne({ email: "harsh@turbocart.com" });
  console.log("By Email:", byEmail);

  // User probably entered their phone number. Let's see all sellers.
  const all = await Seller.find({}, 'email phone name');
  console.log("All Sellers:", all);
  
  process.exit(0);
}

main().catch(console.error);
