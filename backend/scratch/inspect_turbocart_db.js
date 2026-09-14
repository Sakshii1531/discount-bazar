import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const CLOUDINARY_DIR = 'c:/Users/HP/Desktop/Appzeto/turbocart/cloudinary/cloudinary';

function extractPublicId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  return match ? match[1] : null;
}

function findLocalFile(pubId, collectionName) {
  if (!pubId) return null;

  const directPath = path.join(CLOUDINARY_DIR, pubId);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }

  const baseName = path.basename(pubId);
  const collectionSubPath = path.join(CLOUDINARY_DIR, collectionName, baseName);
  if (fs.existsSync(collectionSubPath) && fs.statSync(collectionSubPath).isFile()) {
    return collectionSubPath;
  }

  const searchFolders = ['categories', 'products', 'appzeto_products', 'banners', 'settings', 'sellers', 'default'];
  for (const folder of searchFolders) {
    const p = path.join(CLOUDINARY_DIR, folder, baseName);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }

  return null;
}

async function matchDatabaseImages() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to Turbocart MongoDB');

    const db = mongoose.connection.db;

    // Categories
    const categories = await db.collection('categories').find({ image: { $exists: true, $ne: '' } }).toArray();
    let catMatched = 0;
    for (const cat of categories) {
      if (typeof cat.image !== 'string' || cat.image.startsWith('http://localhost') || cat.image.startsWith('/uploads')) continue;
      const pubId = extractPublicId(cat.image);
      const sourceFile = findLocalFile(pubId, 'categories');
      if (sourceFile) catMatched++;
    }
    console.log(`Turbocart Categories matched: ${catMatched} / ${categories.length}`);

    // Products
    const products = await db.collection('products').find({}).toArray();
    let prodMatched = 0;
    for (const prod of products) {
      const urls = [];
      if (prod.mainImage) urls.push(prod.mainImage);
      if (Array.isArray(prod.images)) urls.push(...prod.images);

      for (const u of urls) {
        if (!u || typeof u !== 'string' || u.startsWith('http://localhost') || u.startsWith('/uploads')) continue;
        const pubId = extractPublicId(u);
        const sourceFile = findLocalFile(pubId, 'products');
        if (sourceFile) {
          prodMatched++;
          break;
        }
      }
    }
    console.log(`Turbocart Products matched: ${prodMatched} / ${products.length}`);

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

matchDatabaseImages();
