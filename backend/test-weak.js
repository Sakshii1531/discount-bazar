import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import path from 'path';

dotenv.config({ path: path.resolve('.env') });

const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quickcommerce";

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
  
  const aman = await Seller.findOne({ email: "amanjain4691@gmail.com" }).select("+password");
  
  const passwordsToTest = ["Admin!@#123", "Aman@1234", "12345678", "password", "Aman@123", "123456789"];
  
  for (const p of passwordsToTest) {
    const isMatch = await aman.comparePassword(p);
    console.log(`Password: ${p} -> ${isMatch}`);
  }
  
  process.exit(0);
}

main().catch(console.error);
