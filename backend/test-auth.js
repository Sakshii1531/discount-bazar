import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import path from 'path';

dotenv.config({ path: path.resolve('.env') });

const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quickcommerce";

// Mock Seller model with comparePassword
const sellerSchema = new mongoose.Schema({
  email: String,
  phone: String,
  password: { type: String, select: false }
}, { strict: false });

sellerSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const Seller = mongoose.model('SellerTest', sellerSchema, 'sellers');

async function main() {
  await mongoose.connect(uri);
  
  // Try finding by email
  const sellerEmail = await Seller.findOne({ email: "amanjain4691@gmail.com" }).select("+password");
  console.log("Found by email:", sellerEmail ? sellerEmail.email : "Not found");
  if (sellerEmail) {
    const isMatch = await sellerEmail.comparePassword("Aman@123");
    console.log("Email password match:", isMatch);
  }

  // Try finding by phone
  const sellerPhone = await Seller.findOne({ phone: "9407235770" }).select("+password");
  console.log("Found by phone:", sellerPhone ? sellerPhone.phone : "Not found");
  if (sellerPhone) {
    const isMatch = await sellerPhone.comparePassword("Aman@123");
    console.log("Phone password match:", isMatch);
    
    // Are they the same document?
    console.log("Same ID?", sellerEmail && sellerEmail._id.toString() === sellerPhone._id.toString());
  }

  process.exit(0);
}

main().catch(console.error);
