import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const heroconfigs = await db.collection('heroconfigs').find().toArray();
  for (let config of heroconfigs) {
    const items = config.banners?.items || [];
    const newItems = items.filter(item => {
      if (item.imageUrl && item.imageUrl.includes('lj2iapfec2af649ff0pl')) {
        console.log(`Removing banner from config: ${config._id}`);
        return false;
      }
      return true;
    });

    if (newItems.length !== items.length) {
      await db.collection('heroconfigs').updateOne(
        { _id: config._id },
        { $set: { "banners.items": newItems } }
      );
      console.log(`Successfully updated config: ${config._id}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
