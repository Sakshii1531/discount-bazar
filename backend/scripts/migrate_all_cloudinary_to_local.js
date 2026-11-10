import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const UPLOADS_ROOT = path.join(__dirname, '../public/uploads');

function getLocalRelativePath(cloudinaryUrl) {
  if (!cloudinaryUrl || typeof cloudinaryUrl !== 'string') return null;
  const match = cloudinaryUrl.match(/\/upload\/(?:[a-zA-Z0-9_,]+\/)?(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  let relativePath = match[1];
  relativePath = relativePath.split('?')[0].split('#')[0];
  relativePath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `/uploads/${relativePath}`;
}

async function downloadWithRetry(url, destFilePath, maxRetries = 3) {
  const dir = path.dirname(destFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Check if already downloaded
  if (fs.existsSync(destFilePath)) {
    const stat = fs.statSync(destFilePath);
    if (stat.size > 0) {
      return { skipped: true, size: stat.size };
    }
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      fs.writeFileSync(destFilePath, buffer);
      return { success: true, size: buffer.length };
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function downloadPool(urlMap, concurrency = 10) {
  const entries = Array.from(urlMap.entries());
  let index = 0;
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalBytes = 0;
  const failedUrls = [];

  console.log(`Starting download of ${entries.length} assets with concurrency ${concurrency}...`);

  async function worker() {
    while (index < entries.length) {
      const currentIndex = index++;
      const [cloudinaryUrl, localRelativePath] = entries[currentIndex];
      const destPath = path.join(__dirname, '../public', localRelativePath);

      try {
        const result = await downloadWithRetry(cloudinaryUrl, destPath);
        if (result.skipped) {
          skippedCount++;
        } else {
          downloadedCount++;
        }
        totalBytes += result.size || 0;
      } catch (err) {
        failedCount++;
        failedUrls.push({ url: cloudinaryUrl, error: err.message });
        console.error(`\nFailed [${currentIndex + 1}/${entries.length}] ${cloudinaryUrl}: ${err.message}`);
      }

      const totalDone = downloadedCount + skippedCount + failedCount;
      if (totalDone % 50 === 0 || totalDone === entries.length) {
        process.stdout.write(`\rProgress: ${totalDone}/${entries.length} (Downloaded: ${downloadedCount}, Skipped: ${skippedCount}, Failed: ${failedCount})`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  console.log('\nAsset download phase finished.');
  return { downloadedCount, skippedCount, failedCount, totalBytes, failedUrls };
}

function replaceUrlsInObject(obj, urlMap) {
  let changed = false;

  function traverse(current) {
    if (!current || typeof current !== 'object') return;

    for (const key of Object.keys(current)) {
      const val = current[key];
      if (typeof val === 'string') {
        if (urlMap.has(val)) {
          current[key] = urlMap.get(val);
          changed = true;
        } else if (val.includes('res.cloudinary.com')) {
          let updated = val;
          for (const [cUrl, lPath] of urlMap.entries()) {
            if (updated.includes(cUrl)) {
              updated = updated.replaceAll(cUrl, lPath);
            }
          }
          if (updated !== val) {
            current[key] = updated;
            changed = true;
          }
        }
      } else if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (typeof val[i] === 'string') {
            if (urlMap.has(val[i])) {
              val[i] = urlMap.get(val[i]);
              changed = true;
            } else if (val[i].includes('res.cloudinary.com')) {
              let updated = val[i];
              for (const [cUrl, lPath] of urlMap.entries()) {
                if (updated.includes(cUrl)) {
                  updated = updated.replaceAll(cUrl, lPath);
                }
              }
              if (updated !== val[i]) {
                val[i] = updated;
                changed = true;
              }
            }
          } else if (val[i] && typeof val[i] === 'object') {
            traverse(val[i]);
          }
        }
      } else if (val && typeof val === 'object') {
        traverse(val);
      }
    }
  }

  traverse(obj);
  return changed;
}

async function run() {
  const startTime = Date.now();
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected.');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const urlMap = new Map();

  console.log('Scanning database for Cloudinary URLs...');
  for (const col of collections) {
    const docs = await db.collection(col.name).find({}).toArray();
    for (const doc of docs) {
      const str = JSON.stringify(doc);
      const matches = str.match(/https?:\/\/[^"\\]*res\.cloudinary\.com[^"\\]*/g);
      if (matches) {
        for (const u of matches) {
          const clean = u.replace(/["\\]+$/, '');
          const localPath = getLocalRelativePath(clean);
          if (localPath) {
            urlMap.set(clean, localPath);
          }
        }
      }
    }
  }

  console.log(`Found ${urlMap.size} unique Cloudinary assets to download.\n`);

  // Phase 1: Download Assets to backend/public/uploads
  const downloadSummary = await downloadPool(urlMap, 10);
  console.log('\nDownload Summary:');
  console.log(`- Newly Downloaded: ${downloadSummary.downloadedCount}`);
  console.log(`- Already on Disk (Skipped): ${downloadSummary.skippedCount}`);
  console.log(`- Failed: ${downloadSummary.failedCount}`);
  console.log(`- Total Downloaded Size: ${(downloadSummary.totalBytes / (1024 * 1024)).toFixed(2)} MB`);

  if (downloadSummary.failedCount > 0) {
    console.warn(`WARNING: ${downloadSummary.failedCount} assets failed to download. Check failedUrls:`, downloadSummary.failedUrls.slice(0, 5));
  }

  // Phase 2: Update MongoDB Documents
  console.log('\n--- Phase 2: Updating MongoDB Collections ---');
  let totalDocsUpdated = 0;
  for (const col of collections) {
    const colName = col.name;
    const docs = await db.collection(colName).find({}).toArray();
    let colUpdated = 0;

    for (const doc of docs) {
      const str = JSON.stringify(doc);
      if (str.includes('res.cloudinary.com')) {
        const isChanged = replaceUrlsInObject(doc, urlMap);
        if (isChanged) {
          await db.collection(colName).replaceOne({ _id: doc._id }, doc);
          colUpdated++;
        }
      }
    }

    if (colUpdated > 0) {
      totalDocsUpdated += colUpdated;
      console.log(`Collection "${colName}": updated ${colUpdated} documents.`);
    }
  }

  console.log(`\nDatabase update complete! Total documents updated across all collections: ${totalDocsUpdated}`);
  console.log(`Total duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  await mongoose.disconnect();
  console.log('MongoDB disconnected. Migration successful.');
}

run().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});

