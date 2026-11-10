import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

export const uploadToCloudinary = async (fileBuffer, folder = 'categories', options = {}) => {
    const sanitizeFolder = String(folder || "uploads").replace(/[^a-zA-Z0-9_\-\/]/g, "");
    const targetDir = path.resolve(__dirname, "../../public/uploads", sanitizeFolder);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const mimeType = String(options.mimeType || "").trim().toLowerCase();
    let ext = "";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = ".jpg";
    else if (mimeType.includes("png")) ext = ".png";
    else if (mimeType.includes("webp")) ext = ".webp";
    else if (mimeType.includes("gif")) ext = ".gif";
    else if (mimeType.includes("pdf")) ext = ".pdf";
    else if (mimeType.includes("mp4")) ext = ".mp4";
    else {
        const origExt = path.extname(options.filename || "");
        ext = origExt || ".jpg";
    }

    const uniqueName = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
    const filePath = path.join(targetDir, uniqueName);

    await fs.promises.writeFile(filePath, fileBuffer);

    return `/uploads/${sanitizeFolder}/${uniqueName}`;
};

export default cloudinary;
