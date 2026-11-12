import { resolveApiBaseUrl } from "../api/resolveApiBaseUrl";

const CLOUDINARY_REGEX = /res\.cloudinary\.com/i;
const CLOUDINARY_UPLOAD_SEGMENT_REGEX = /\/upload\/([^/]+)\//i;

function getBackendOrigin() {
  try {
    const apiUrl = resolveApiBaseUrl();
    const parsed = new URL(apiUrl, window.location.origin);
    return parsed.origin;
  } catch {
    const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `${protocol}//${host}:7000`;
  }
}

/**
 * Appends Cloudinary optimisation transforms to a URL.
 * Safe to call on any URL — non-Cloudinary URLs are returned unchanged.
 * For local server uploads (/uploads/...), prepends backend origin.
 */
export function applyCloudinaryTransform(url, params = "f_auto,q_auto,w_400,dpr_auto") {
  if (!url || typeof url !== "string") return url;
  // A photo just picked in a form (not uploaded yet) is shown as-is.
  if (/^(data|blob):/i.test(url)) return url;

  // Server uploads: "/uploads/..." or an absolute URL whose path starts with
  // /uploads/ (saved before uploads became relative) — served by this backend.
  // Other sites' ".../wp-content/uploads/..." images are left alone.
  if (url.startsWith("/uploads/")) return `${getBackendOrigin()}${url}`;
  if (/^https?:\/\//i.test(url)) {
    try {
      const { pathname, search } = new URL(url);
      if (pathname.startsWith("/uploads/")) return `${getBackendOrigin()}${pathname}${search}`;
    } catch {
      return url;
    }
  }

  if (!CLOUDINARY_REGEX.test(url)) return url;
  const match = url.match(CLOUDINARY_UPLOAD_SEGMENT_REGEX);
  if (!match) return url;

  const segmentAfterUpload = match[1] || "";
  const alreadyHasTransforms =
    segmentAfterUpload.includes(",") ||
    /^[a-z]{1,4}_[^/]+$/i.test(segmentAfterUpload);

  if (alreadyHasTransforms) return url;

  // Insert transform before the segment after `/upload/` (often `v123...`).
  return url.replace(CLOUDINARY_UPLOAD_SEGMENT_REGEX, `/upload/${params}/$1/`);
}

export function isCloudinaryUrl(url) {
  return !!url && CLOUDINARY_REGEX.test(url);
}

export function buildCloudinarySrcSet(
  url,
  entries,
  baseParams = "f_auto,q_auto,c_fill,g_auto",
) {
  if (!isCloudinaryUrl(url) || !Array.isArray(entries) || entries.length === 0)
    return undefined;

  return entries
    .map(({ w, h }) => {
      const params = [
        baseParams,
        typeof w === "number" ? `w_${w}` : null,
        typeof h === "number" ? `h_${h}` : null,
      ]
        .filter(Boolean)
        .join(",");

      const href = applyCloudinaryTransform(url, params) || url;
      const descriptor = typeof w === "number" ? `${w}w` : "";
      return descriptor ? `${href} ${descriptor}` : href;
    })
    .join(", ");
}
