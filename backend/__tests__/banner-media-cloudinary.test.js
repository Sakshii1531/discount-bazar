import { jest } from "@jest/globals";

const uploadOptions = [];
jest.unstable_mockModule("cloudinary", () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: (options, callback) => {
        uploadOptions.push(options);
        return { end: () => callback(null, { secure_url: "https://res.cloudinary.com/demo/uploaded" }) };
      },
    },
    utils: { api_sign_request: jest.fn() },
  },
}));

const { uploadToCloudinary } = await import("../app/services/mediaService.js");
const { buildVideoPosterUrl } = await import("../app/services/bannerMediaService.js");

describe("Cloudinary banner storage", () => {
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_SECRET = "test-secret";
  });
  beforeEach(() => {
    uploadOptions.length = 0;
  });

  test("uploads a video as a video resource, without image optimisation", async () => {
    process.env.CLOUDINARY_IMAGE_UPLOAD_FORMAT = "webp";
    await uploadToCloudinary(Buffer.from("x"), "banners", { mimeType: "video/mp4", resourceType: "video" });
    expect(uploadOptions).toEqual([{ folder: "banners", resource_type: "video" }]);
    delete process.env.CLOUDINARY_IMAGE_UPLOAD_FORMAT;
  });

  test("still uploads an image as an image resource", async () => {
    await uploadToCloudinary(Buffer.from("x"), "banners", { mimeType: "image/png", resourceType: "image" });
    expect(uploadOptions[0]).toEqual(expect.objectContaining({ folder: "banners", resource_type: "image" }));
  });

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
