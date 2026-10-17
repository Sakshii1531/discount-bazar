import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ExperienceSection from './app/models/experienceSection.js';
import Product from './app/models/product.js';
dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const sections = await ExperienceSection.find().sort({ createdAt: -1 }).lean();
  console.log('=== SECTIONS ===');
  sections.forEach(s => {
    console.log({
      id: s._id,
      title: s.title,
      pageType: s.pageType,
      displayType: s.displayType,
      status: s.status,
      productsConfig: s.config?.products,
      categoriesConfig: s.config?.categories
    });
  });

  const totalProducts = await Product.countDocuments();
  console.log('Total products in DB:', totalProducts);
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
