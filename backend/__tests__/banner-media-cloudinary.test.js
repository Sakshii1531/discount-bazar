import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { uploadToCloudinary, localUploadExtension } = await import("../app/services/mediaService.js");
const { buildVideoPosterUrl } = await import("../app/services/bannerMediaService.js");

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = Buffer.from("%PDF-1.7\n%....");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom0000")]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  0000")]);

// Uploads are stored on this server (Cloudinary is no longer used).
describe("local media storage", () => {
  const written = [];
  afterAll(() => {
    for (const url of written) {
      const file = path.join(PUBLIC_DIR, url);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  test("saves a banner video as .mp4 under /uploads/banners", async () => {
    const url = await uploadToCloudinary(MP4, "banners", { mimeType: "video/mp4", resourceType: "video" });
    written.push(url);
    expect(url).toMatch(/^\/uploads\/banners\/\d+_[0-9a-f]{8}\.mp4$/);
    expect(fs.readFileSync(path.join(PUBLIC_DIR, url)).equals(MP4)).toBe(true);
  });

  test("saves an image with its own extension", async () => {
    const url = await uploadToCloudinary(PNG, "banners", { mimeType: "image/png", resourceType: "image" });
    written.push(url);
    expect(url).toMatch(/^\/uploads\/banners\/.+\.png$/);
  });

  test("detects the type from the content when no mime type is given", async () => {
    const url = await uploadToCloudinary(PDF, "delivery/documents");
    written.push(url);
    expect(url).toMatch(/^\/uploads\/delivery\/documents\/.+\.pdf$/);
    expect(localUploadExtension(JPG)).toBe(".jpg");
    expect(localUploadExtension(PNG)).toBe(".png");
    expect(localUploadExtension(MOV)).toBe(".mov");
    expect(localUploadExtension(MP4, "")).toBe(".mp4");
  });

  test("never stores executable types, whatever is declared", () => {
    expect(localUploadExtension(Buffer.from("<html><script>x</script></html>"), "text/html")).toBe(".jpg");
    expect(localUploadExtension(Buffer.from("<svg onload=x>............</svg>"), "image/svg+xml")).toBe(".jpg");
  });
});

describe("banner video posters", () => {
  test("derives a sized poster from a Cloudinary video URL", () => {
    expect(buildVideoPosterUrl("https://res.cloudinary.com/acme/video/upload/v12/banners/abc.mp4")).toBe(
      "https://res.cloudinary.com/acme/video/upload/q_auto,c_limit,w_1248/v12/banners/abc.jpg",
    );
  });

  test("has no poster for other storage", () => {
    expect(buildVideoPosterUrl("http://localhost:7000/uploads/banners/abc.mp4")).toBe("");
    expect(buildVideoPosterUrl("")).toBe("");
  });
});
