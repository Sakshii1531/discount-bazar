import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const heroconfigs = await db.collection('heroconfigs').find().toArray();
  console.log(`Total configs in db: ${heroconfigs.length}`);
  for (let config of heroconfigs) {
    console.log(`Config ID: ${config._id}, PageType: ${config.pageType}`);
    console.log(`  Banners count: ${config.banners?.items?.length || 0}`);
    const items = config.banners?.items || [];
    for (let item of items) {
      console.log(`    - imageUrl: ${item.imageUrl}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
