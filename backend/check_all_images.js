import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const collections = ['heroconfigs', 'experiencesections', 'settings', 'categories', 'products'];
  for (let colName of collections) {
    const docs = await db.collection(colName).find().toArray();
    for (let doc of docs) {
      const str = JSON.stringify(doc);
      if (str.includes('dmeawbxhe') || str.includes('dv1l9sb4p') || str.toLowerCase().includes('banner') || str.toLowerCase().includes('zoogno')) {
        // Inspect this doc for image URLs
        const urls = [];
        const matches = str.match(/https?:\/\/[^\s"']+/g) || [];
        for (let m of matches) {
          if (m.includes('cloudinary') && (m.includes('banner') || m.includes('image') || m.includes('logo'))) {
            urls.push(m);
          }
        }
        if (urls.length > 0) {
          console.log(`Collection: ${colName}, ID: ${doc._id}`);
          urls.forEach(u => console.log(`  - ${u}`));
        }
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
