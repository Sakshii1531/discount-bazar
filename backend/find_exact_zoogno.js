import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

function searchDeep(obj, path = '') {
  let results = [];
  if (!obj) return results;
  
  if (typeof obj === 'string') {
    if (obj.toLowerCase().includes('zoogno') || obj.toLowerCase().includes('lj2iapfec2af649ff0pl')) {
      results.push({ path, value: obj });
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((val, idx) => {
      results = results.concat(searchDeep(val, `${path}[${idx}]`));
    });
  } else if (typeof obj === 'object') {
    Object.keys(obj).forEach(key => {
      results = results.concat(searchDeep(obj[key], `${path}.${key}`));
    });
  }
  return results;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const cols = await db.listCollections().toArray();
  for (let col of cols) {
    const docs = await db.collection(col.name).find().toArray();
    for (let doc of docs) {
      const matches = searchDeep(doc);
      if (matches.length > 0) {
        console.log(`\nCollection: ${col.name}, Doc ID: ${doc._id}`);
        matches.forEach(m => {
          console.log(`  Path: ${m.path}`);
          console.log(`  Value: ${m.value}`);
        });
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
