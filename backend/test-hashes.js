import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('.env') });

const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quickcommerce";

const sellerSchema = new mongoose.Schema({
  email: String,
  phone: String,
  password: { type: String, select: false }
}, { strict: false });

const Seller = mongoose.model('SellerTest', sellerSchema, 'sellers');

async function main() {
  await mongoose.connect(uri);
  
  const harsh = await Seller.findOne({ email: "harsh@turbocart.com" }).select("+password");
  console.log("Harsh hash:", harsh ? harsh.password : "Not found");
  
  const aman = await Seller.findOne({ email: "amanjain4691@gmail.com" }).select("+password");
  console.log("Aman hash:", aman ? aman.password : "Not found");
  
  process.exit(0);
}

main().catch(console.error);
