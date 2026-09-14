import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('.env') });

const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quickcommerce";

const sellerSchema = new mongoose.Schema({}, { strict: false });
const Seller = mongoose.model('SellerTest', sellerSchema, 'sellers');

async function main() {
  await mongoose.connect(uri);
  
  const emptyPhones = await Seller.find({ phone: "" });
  console.log("Empty phones:", emptyPhones.length);
  
  process.exit(0);
}

main().catch(console.error);
