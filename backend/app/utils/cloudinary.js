import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const getOptimizedImageFormat = () =>
    String(process.env.CLOUDINARY_IMAGE_UPLOAD_FORMAT || '').trim().toLowerCase();

const getOptimizedImageQuality = () =>
    String(process.env.CLOUDINARY_IMAGE_UPLOAD_QUALITY || '').trim();

const isImageMimeType = (mimeType = '') =>
    String(mimeType || '').trim().toLowerCase().startsWith('image/');

const getImageUploadOptions = () => {
    const format = getOptimizedImageFormat();
    const quality = getOptimizedImageQuality();
    return {
        ...(format ? { format } : {}),
        ...(quality ? { transformation: `q_${quality}` } : {}),
    };
};

export const uploadToCloudinary = async (fileBuffer, folder = 'categories', options = {}) => {
    const sanitizeFolder = String(folder || "uploads").replace(/[^a-zA-Z0-9_\-\/]/g, "");
    const targetDir = path.join(process.cwd(), "public", "uploads", sanitizeFolder);
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
    else {
        const origExt = path.extname(options.filename || "");
        ext = origExt || ".jpg";
    }

    const uniqueName = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
    const filePath = path.join(targetDir, uniqueName);

    await fs.promises.writeFile(filePath, fileBuffer);

    const baseUrl = (process.env.BACKEND_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 7000}`).replace(/\/+$/, "");
    const fullUrl = `${baseUrl}/uploads/${sanitizeFolder}/${uniqueName}`;
    return fullUrl;
};

export default cloudinary;
