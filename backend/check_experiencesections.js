import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const sections = await db.collection('experiencesections').find().toArray();
  console.log(`Total experience sections: ${sections.length}`);
  for (let sec of sections) {
    const str = JSON.stringify(sec);
    if (str.toLowerCase().includes('zoogno') || str.toLowerCase().includes('lj2iapfec2af649ff0pl') || str.toLowerCase().includes('banners')) {
      console.log(`\nFound matching section! ID: ${sec._id}, pageType: ${sec.pageType}, title: ${sec.title}, type: ${sec.type}`);
      if (sec.items) {
        console.log("Items:");
        sec.items.forEach((item, idx) => {
          console.log(`  - Item ${idx}: imageUrl: ${item.imageUrl || item.image || 'no image'}`);
        });
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
