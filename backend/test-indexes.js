import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('.env') });

const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quickcommerce";

const sellerSchema = new mongoose.Schema({}, { strict: false });
const Seller = mongoose.model('SellerTest', sellerSchema, 'sellers');

async function main() {
  await mongoose.connect(uri);
  
  const indexes = await Seller.collection.indexes();
  console.log(indexes);
  
  // Find all sellers with phone 9407235770
  const amans = await Seller.find({ phone: '9407235770' });
  console.log("Count of Aman's phone:", amans.length);
  
  process.exit(0);
}

main().catch(console.error);
