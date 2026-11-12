/**
 * Image / document references accepted from uploads and request bodies.
 *
 * Uploads are stored on this server and saved as relative paths
 * (`/uploads/<folder>/<file>`, see mediaService.uploadToLocal); older records
 * and external links are absolute http(s) URLs. Both are valid. Anything else
 * (data URLs, `javascript:`, paths outside /uploads, `..` traversal) is not.
 */
const HTTP_URL = /^https?:\/\//i;
const LOCAL_UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9_\-./]+$/;

export function isLocalUploadPath(value) {
  const s = String(value ?? "").trim();
  return LOCAL_UPLOAD_PATH.test(s) && !s.includes("..") && !s.includes("//");
}

export function isMediaUrl(value) {
  const s = String(value ?? "").trim();
  return HTTP_URL.test(s) || isLocalUploadPath(s);
}

/** The trimmed reference when it is a valid media URL, otherwise "". */
export function normalizeMediaUrl(value) {
  const s = String(value ?? "").trim();
  return isMediaUrl(s) ? s : "";
}

/**
 * Absolute URL for places that cannot resolve a relative path (emails, push
 * notifications). Relative upload paths are prefixed with the public backend
 * URL; returns "" when no base URL is configured.
 */
export function absoluteMediaUrl(value) {
  const s = String(value ?? "").trim();
  if (HTTP_URL.test(s)) return s;
  if (!isLocalUploadPath(s)) return "";
  const base = String(process.env.BACKEND_URL || process.env.SERVER_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}${s}` : "";
}
