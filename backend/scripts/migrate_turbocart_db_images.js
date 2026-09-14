import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const CLOUDINARY_DIR = 'c:/Users/HP/Desktop/Appzeto/turbocart/cloudinary/cloudinary';
const UPLOADS_ROOT = path.join(__dirname, '../public/uploads');
const BACKEND_URL = (process.env.BACKEND_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 7000}`).replace(/\/+$/, '');

function extractPublicId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  return match ? match[1] : null;
}

function findLocalFile(pubId, collectionName) {
  if (!pubId) return null;

  // 1. Direct path match
  const directPath = path.join(CLOUDINARY_DIR, pubId);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }

  // 2. Basename search in collection folder
  const baseName = path.basename(pubId);
  const collectionSubPath = path.join(CLOUDINARY_DIR, collectionName, baseName);
  if (fs.existsSync(collectionSubPath) && fs.statSync(collectionSubPath).isFile()) {
    return collectionSubPath;
  }

  // 3. Search in common folders
  const searchFolders = ['categories', 'products', 'appzeto_products', 'banners', 'settings', 'sellers', 'default'];
  for (const folder of searchFolders) {
    const p = path.join(CLOUDINARY_DIR, folder, baseName);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }

  return null;
}

function copyToUploads(sourceFilePath, collectionName, filename) {
  const targetDir = path.join(UPLOADS_ROOT, collectionName);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const destPath = path.join(targetDir, filename);
  fs.copyFileSync(sourceFilePath, destPath);
  return `${BACKEND_URL}/uploads/${collectionName}/${filename}`;
}

async function runMigration() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to Turbocart MongoDB for Image Migration...');

    const db = mongoose.connection.db;

    // --- 1. Migrate Categories ---
    console.log('\n--- Migrating Category Images ---');
    const categories = await db.collection('categories').find({ image: { $exists: true, $ne: '' } }).toArray();
    let catMigrated = 0;

    for (const cat of categories) {
      if (typeof cat.image !== 'string') continue;
      if (cat.image.startsWith('http://localhost') || cat.image.startsWith('/uploads')) continue;

      const pubId = extractPublicId(cat.image);
      const sourceFile = findLocalFile(pubId, 'categories');

      if (sourceFile) {
        const ext = path.extname(sourceFile) || '.jpg';
        const filename = `${cat._id}${ext}`;
        const newUrl = copyToUploads(sourceFile, 'categories', filename);

        await db.collection('categories').updateOne(
          { _id: cat._id },
          { $set: { image: newUrl } }
        );
        catMigrated++;
        console.log(`[Category] Updated "${cat.name}" -> ${newUrl}`);
      }
    }
    console.log(`Turbocart category migration finished: ${catMigrated} updated.`);

    // --- 2. Migrate Products ---
    console.log('\n--- Migrating Product Images ---');
    const products = await db.collection('products').find({}).toArray();
    let prodMigrated = 0;

    for (const prod of products) {
      let updated = false;
      const updatePayload = {};

      if (prod.mainImage && typeof prod.mainImage === 'string' && !prod.mainImage.startsWith('http://localhost') && !prod.mainImage.startsWith('/uploads')) {
        const pubId = extractPublicId(prod.mainImage);
        const sourceFile = findLocalFile(pubId, 'products');

        if (sourceFile) {
          const ext = path.extname(sourceFile) || '.jpg';
          const filename = `${prod._id}_main${ext}`;
          const newUrl = copyToUploads(sourceFile, 'products', filename);
          updatePayload.mainImage = newUrl;
          updated = true;
        }
      }

      if (Array.isArray(prod.images) && prod.images.length > 0) {
        const newImages = [];
        let imgIndex = 0;

        for (const imgUrl of prod.images) {
          if (!imgUrl || typeof imgUrl !== 'string') continue;
          if (imgUrl.startsWith('http://localhost') || imgUrl.startsWith('/uploads')) {
            newImages.push(imgUrl);
            continue;
          }

          const pubId = extractPublicId(imgUrl);
          const sourceFile = findLocalFile(pubId, 'products');

          if (sourceFile) {
            const ext = path.extname(sourceFile) || '.jpg';
            const filename = `${prod._id}_${imgIndex++}${ext}`;
            const newUrl = copyToUploads(sourceFile, 'products', filename);
            newImages.push(newUrl);
            updated = true;
          } else {
            newImages.push(imgUrl);
          }
        }

        if (updated) {
          updatePayload.images = newImages;
        }
      }

      if (updated) {
        await db.collection('products').updateOne(
          { _id: prod._id },
          { $set: updatePayload }
        );
        prodMigrated++;
        console.log(`[Product] Updated "${prod.name}"`);
      }
    }
    console.log(`Turbocart product migration finished: ${prodMigrated} updated.`);

    // --- 3. Migrate Experience Banners ---
    console.log('\n--- Migrating Banners ---');
    const banners = await db.collection('banners').find({}).toArray();
    let bannerMigrated = 0;

    for (const banner of banners) {
      if (banner.image && typeof banner.image === 'string' && !banner.image.startsWith('http://localhost') && !banner.image.startsWith('/uploads')) {
        const pubId = extractPublicId(banner.image);
        const sourceFile = findLocalFile(pubId, 'banners');

        if (sourceFile) {
          const ext = path.extname(sourceFile) || '.jpg';
          const filename = `${banner._id}${ext}`;
          const newUrl = copyToUploads(sourceFile, 'banners', filename);

          await db.collection('banners').updateOne(
            { _id: banner._id },
            { $set: { image: newUrl } }
          );
          bannerMigrated++;
          console.log(`[Banner] Updated banner ${banner._id} -> ${newUrl}`);
        }
      }
    }
    console.log(`Turbocart banner migration finished: ${bannerMigrated} updated.`);

    console.log('\n=============================================');
    console.log(`TURBOCART MIGRATION SUMMARY:`);
    console.log(`- Categories updated: ${catMigrated}`);
    console.log(`- Products updated: ${prodMigrated}`);
    console.log(`- Banners updated: ${bannerMigrated}`);
    console.log('=============================================');

    await mongoose.disconnect();
  } catch (err) {
    console.error('Turbocart migration failed:', err);
  }
}

runMigration();
