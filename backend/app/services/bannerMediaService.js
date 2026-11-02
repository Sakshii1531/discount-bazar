const MB = 1024 * 1024;

const positiveNumberFromEnv = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

/** Upload rules for banners. Read per call so an env change never needs a code change. */
export function getBannerMediaConfig() {
  const allowedMimeTypes = (process.env.BANNER_ALLOWED_MIME_TYPES || "image/jpeg,image/png,image/webp,video/mp4")
    .split(",")
    .map((mime) => mime.trim().toLowerCase())
    .filter(Boolean);

  return {
    allowedMimeTypes,
    maxImageBytes: Math.round(positiveNumberFromEnv("BANNER_IMAGE_MAX_SIZE_MB", 20) * MB),
    maxVideoBytes: Math.round(positiveNumberFromEnv("BANNER_VIDEO_MAX_SIZE_MB", 20) * MB),
    maxVideoDurationSeconds: positiveNumberFromEnv("BANNER_VIDEO_MAX_DURATION_SECONDS", 30),
  };
}

const asciiAt = (buffer, start, end) => buffer.toString("latin1", start, end);

// Trust the file's bytes, not the extension or the Content-Type the client sent.
export function detectBannerMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (asciiAt(buffer, 0, 4) === "RIFF" && asciiAt(buffer, 8, 12) === "WEBP") return "image/webp";
  if (asciiAt(buffer, 0, 3) === "GIF") return "image/gif";
  // QuickTime shares the ftyp box with MP4 but does not play in every browser.
  if (asciiAt(buffer, 4, 8) === "ftyp" && asciiAt(buffer, 8, 12) !== "qt  ") return "video/mp4";
  return null;
}

function findMp4Box(buffer, type, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    let headerSize = 8;
    let size = buffer.readUInt32BE(offset);
    if (size === 1) {
      if (offset + 16 > end) return null;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize) return null;
    if (asciiAt(buffer, offset + 4, offset + 8) === type) {
      return { start: offset + headerSize, end: Math.min(offset + size, end) };
    }
    offset += size;
  }
  return null;
}

/** Duration from the MP4's movie header (moov > mvhd), or null when it cannot be read. */
export function readMp4DurationSeconds(buffer) {
  const moov = findMp4Box(buffer, "moov", 0, buffer.length);
  const mvhd = moov && findMp4Box(buffer, "mvhd", moov.start, moov.end);
  if (!mvhd) return null;

  const isVersion1 = buffer[mvhd.start] === 1;
  const timescaleAt = mvhd.start + (isVersion1 ? 20 : 12);
  if (timescaleAt + (isVersion1 ? 12 : 8) > mvhd.end) return null;

  const timescale = buffer.readUInt32BE(timescaleAt);
  const duration = isVersion1
    ? Number(buffer.readBigUInt64BE(timescaleAt + 4))
    : buffer.readUInt32BE(timescaleAt + 4);
  return timescale > 0 && duration > 0 ? duration / timescale : null;
}

const invalidUpload = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

const toMb = (bytes) => Number((bytes / MB).toFixed(2));

/**
 * Checks an uploaded banner file against the configured rules and works out
 * what it is. Throws a 400 with an admin-readable message when it is not allowed.
 */
export function inspectBannerFile(buffer) {
  const config = getBannerMediaConfig();
  const mimeType = detectBannerMimeType(buffer);
  if (!mimeType || !config.allowedMimeTypes.includes(mimeType)) {
    throw invalidUpload("Unsupported file. Please upload a JPG, PNG, WebP image or an MP4 video.");
  }

  if (mimeType.startsWith("image/")) {
    if (buffer.length > config.maxImageBytes) {
      throw invalidUpload(`Image is too large. The maximum size is ${toMb(config.maxImageBytes)} MB.`);
    }
    return { mediaType: "image", mimeType };
  }

  if (buffer.length > config.maxVideoBytes) {
    throw invalidUpload(`Video is too large. The maximum size is ${toMb(config.maxVideoBytes)} MB.`);
  }
  const duration = readMp4DurationSeconds(buffer);
  if (!duration) {
    throw invalidUpload("Could not read this video's length. Please export it again as a standard MP4.");
  }
  if (duration > config.maxVideoDurationSeconds) {
    throw invalidUpload(`Video is too long. The maximum length is ${config.maxVideoDurationSeconds} seconds.`);
  }
  return { mediaType: "video", mimeType, duration };
}

// Cloudinary renders a frame of a video when the URL asks for a .jpg. The size
// lives in the URL because the customer app leaves already-transformed URLs alone.
export function buildVideoPosterUrl(videoUrl = "") {
  const match = String(videoUrl).match(/^(https:\/\/res\.cloudinary\.com\/.+\/video\/upload\/)(.+)\.[a-z0-9]+$/i);
  return match ? `${match[1]}q_auto,c_limit,w_1248/${match[2]}.jpg` : "";
}

/** Banner media fields to store; banners saved before video support are images. */
export function normalizeBannerMedia(banner) {
  if (banner?.mediaType === "video" && banner.videoUrl) {
    return { mediaType: "video", videoUrl: banner.videoUrl, imageUrl: banner.imageUrl || "" };
  }
  return { mediaType: "image", videoUrl: "", imageUrl: banner?.imageUrl };
}

export const hasBannerMedia = (banner) =>
  Boolean(banner && (banner.imageUrl || (banner.mediaType === "video" && banner.videoUrl)));
