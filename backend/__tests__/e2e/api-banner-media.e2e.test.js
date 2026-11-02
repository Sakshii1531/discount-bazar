/**
 * API E2E — banners accept short MP4 videos as well as images: file rules come
 * from config and the file's real bytes, and the media type is stored and
 * returned for the customer app. Banners saved before videos keep working.
 */
import fs from "fs";
import path from "path";
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import HeroConfig from "../../app/models/heroConfig.js";
import { mp4Buffer } from "../helpers/mp4Buffer.js";

jest.setTimeout(120000);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]);
const VIDEO_URL = "https://res.cloudinary.com/demo/video/upload/v1/banners/promo.mp4";
const POSTER_URL = "https://res.cloudinary.com/demo/video/upload/q_auto,c_limit,w_1248/v1/banners/promo.jpg";
const IMAGE_URL = "https://cdn.example.test/banner.png";

const CONFIG_ENV = [
  "BANNER_VIDEO_MAX_DURATION_SECONDS",
  "BANNER_VIDEO_MAX_SIZE_MB",
  "BANNER_IMAGE_MAX_SIZE_MB",
  "BANNER_ALLOWED_MIME_TYPES",
];

let app;
let auth;
const uploaded = [];

beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(async () => {
  const admin = await fx.createAdmin();
  auth = bearer("admin", admin._id);
});
afterEach(async () => {
  CONFIG_ENV.forEach((key) => delete process.env[key]);
  await clearDatabase();
});
afterAll(async () => {
  for (const url of uploaded) {
    const file = path.join(process.cwd(), "public", new URL(url).pathname);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  await stopTestApp();
});

const upload = async (buffer, filename, contentType) => {
  const res = await request(app)
    .post("/api/admin/experience/upload-banner")
    .set("Authorization", auth)
    .attach("image", buffer, { filename, contentType });
  if (res.body.result?.url) uploaded.push(res.body.result.url);
  return res;
};

const saveHero = (items) =>
  request(app)
    .put("/api/admin/experience/hero")
    .set("Authorization", auth)
    .send({ pageType: "home", banners: { items } });

const publicHeroItems = async () => {
  const res = await request(app).get("/api/experience/hero").query({ pageType: "home" }).expect(200);
  return res.body.result.banners.items;
};

describe("banner upload", () => {
  it("stores an MP4 as a video and says so", async () => {
    const res = await upload(mp4Buffer({ seconds: 12 }), "promo.mp4", "video/mp4");
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual(
      expect.objectContaining({ mediaType: "video", duration: 12, posterUrl: "" }),
    );
    expect(res.body.result.url).toMatch(/\/uploads\/banners\/.+\.mp4$/);
    expect(res.body.result.videoUrl).toBe(res.body.result.url);
  });

  it("stores the video byte for byte, so its audio track is untouched", async () => {
    const original = mp4Buffer({ seconds: 12, padBytes: 2048 });
    const res = await upload(original, "promo.mp4", "video/mp4");
    const stored = fs.readFileSync(path.join(process.cwd(), "public", new URL(res.body.result.url).pathname));
    expect(stored.equals(original)).toBe(true);
  });

  it("keeps image uploads as they were", async () => {
    const res = await upload(PNG, "banner.png", "image/png");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Banner image uploaded");
    expect(res.body.result.mediaType).toBe("image");
    expect(res.body.result.url).toMatch(/\/uploads\/banners\/.+\.png$/);
  });

  it("identifies the file from its bytes, not the type the client claims", async () => {
    const res = await upload(mp4Buffer({ seconds: 5 }), "looks-like-image.png", "image/png");
    expect(res.status).toBe(200);
    expect(res.body.result.mediaType).toBe("video");
    expect(res.body.result.url).toMatch(/\.mp4$/);
  });

  it.each([
    ["a video over the length limit", () => mp4Buffer({ seconds: 31 }), "video/mp4", /too long.*30 seconds/i],
    ["text renamed to .mp4", () => Buffer.from("this is not a video, only some text"), "video/mp4", /unsupported/i],
    ["a QuickTime file", () => mp4Buffer({ seconds: 5, brand: "qt  " }), "video/quicktime", /unsupported/i],
    ["an MP4 with no readable length", () => mp4Buffer({ seconds: 0 }), "video/mp4", /length/i],
    ["a GIF while GIFs are off", () => GIF, "image/gif", /unsupported/i],
  ])("rejects %s", async (_label, makeBuffer, contentType, message) => {
    const res = await upload(makeBuffer(), "file.bin", contentType);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
  });

  it("reads the length of 64-bit MP4 headers too", async () => {
    const res = await upload(mp4Buffer({ seconds: 31, version: 1 }), "long.mp4", "video/mp4");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too long/i);
  });

  it("takes every limit from config", async () => {
    process.env.BANNER_VIDEO_MAX_DURATION_SECONDS = "10";
    process.env.BANNER_ALLOWED_MIME_TYPES = "image/png,image/gif,video/mp4";

    const config = await request(app)
      .get("/api/admin/experience/banner-upload-config")
      .set("Authorization", auth)
      .expect(200);
    expect(config.body.result).toEqual({
      allowedMimeTypes: ["image/png", "image/gif", "video/mp4"],
      maxImageBytes: 20 * 1024 * 1024,
      maxVideoBytes: 20 * 1024 * 1024,
      maxVideoDurationSeconds: 10,
    });

    expect((await upload(mp4Buffer({ seconds: 11 }), "v.mp4", "video/mp4")).status).toBe(400);
    expect((await upload(GIF, "a.gif", "image/gif")).status).toBe(200);
  });

  it("rejects a video over the size limit, even when images may be larger", async () => {
    process.env.BANNER_VIDEO_MAX_SIZE_MB = "0.01";
    process.env.BANNER_IMAGE_MAX_SIZE_MB = "1";
    const res = await upload(mp4Buffer({ seconds: 5, padBytes: 20 * 1024 }), "big.mp4", "video/mp4");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/video is too large/i);
  });

  it("stops a file bigger than every limit before it is processed", async () => {
    process.env.BANNER_VIDEO_MAX_SIZE_MB = "0.01";
    process.env.BANNER_IMAGE_MAX_SIZE_MB = "0.01";
    const res = await upload(mp4Buffer({ seconds: 5, padBytes: 20 * 1024 }), "big.mp4", "video/mp4");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/file is too large/i);
  });

  it("is admin only", async () => {
    await request(app).get("/api/admin/experience/banner-upload-config").expect(401);
    await request(app).post("/api/admin/experience/upload-banner").expect(401);
  });
});

describe("saving banners", () => {
  it("creates, replaces and deletes a video hero banner", async () => {
    await saveHero([{ mediaType: "video", videoUrl: VIDEO_URL, imageUrl: POSTER_URL, linkType: "product", linkValue: "p1" }]).then(
      (res) => expect(res.status).toBe(200),
    );
    expect(await publicHeroItems()).toEqual([
      expect.objectContaining({ mediaType: "video", videoUrl: VIDEO_URL, imageUrl: POSTER_URL, linkType: "product", linkValue: "p1" }),
    ]);

    // Video -> image leaves nothing of the video behind.
    await saveHero([{ mediaType: "image", videoUrl: "", imageUrl: IMAGE_URL }]).then((res) => expect(res.status).toBe(200));
    const [replaced] = await publicHeroItems();
    expect(replaced).toEqual(expect.objectContaining({ mediaType: "image", imageUrl: IMAGE_URL, videoUrl: "" }));

    await saveHero([]).then((res) => expect(res.status).toBe(200));
    expect(await publicHeroItems()).toEqual([]);
  });

  it("accepts a video with no poster, which local storage cannot make", async () => {
    await saveHero([{ mediaType: "video", videoUrl: VIDEO_URL, imageUrl: "" }]).then((res) => expect(res.status).toBe(200));
    expect(await publicHeroItems()).toEqual([expect.objectContaining({ mediaType: "video", videoUrl: VIDEO_URL })]);
  });

  it("drops empty rows and a video type with no video", async () => {
    await saveHero([{ title: "empty" }, { mediaType: "video", videoUrl: "", imageUrl: "" }, { imageUrl: IMAGE_URL }]).then((res) =>
      expect(res.status).toBe(200),
    );
    const items = await publicHeroItems();
    expect(items).toHaveLength(1);
    expect(items[0].imageUrl).toBe(IMAGE_URL);
  });

  it("still serves and re-saves banners stored before videos existed", async () => {
    await HeroConfig.collection.insertOne({
      pageType: "home",
      headerId: null,
      banners: { items: [{ imageUrl: IMAGE_URL, title: "Old", linkType: "none", status: "active" }] },
      categoryIds: [],
    });
    const [served] = await publicHeroItems();
    expect(served.imageUrl).toBe(IMAGE_URL);
    expect(served.mediaType).toBeUndefined();

    await saveHero([served]).then((res) => expect(res.status).toBe(200));
    const [saved] = await publicHeroItems();
    expect(saved).toEqual(expect.objectContaining({ imageUrl: IMAGE_URL, title: "Old", mediaType: "image" }));
  });

  it("creates, edits and deletes a video banner section", async () => {
    const items = [{ mediaType: "video", videoUrl: VIDEO_URL, imageUrl: "", title: "Promo" }];
    const created = await request(app)
      .post("/api/admin/experience")
      .set("Authorization", auth)
      .send({ pageType: "home", displayType: "banners", config: { items } });
    expect(created.status).toBe(201);
    expect(created.body.result.config.banners.items[0]).toEqual(
      expect.objectContaining({ mediaType: "video", videoUrl: VIDEO_URL, title: "Promo" }),
    );

    const id = created.body.result._id;
    const updated = await request(app)
      .put(`/api/admin/experience/${id}`)
      .set("Authorization", auth)
      .send({ config: { items: [{ mediaType: "image", imageUrl: IMAGE_URL }] } });
    expect(updated.status).toBe(200);
    expect(updated.body.result.config.banners.items[0]).toEqual(
      expect.objectContaining({ mediaType: "image", imageUrl: IMAGE_URL }),
    );

    await request(app).delete(`/api/admin/experience/${id}`).set("Authorization", auth).expect(200);
  });

  it("still refuses an image banner with no image", async () => {
    const section = await HeroConfig.create({ pageType: "home", headerId: null, banners: { items: [{ imageUrl: IMAGE_URL }] } });
    section.banners.items[0].imageUrl = "";
    await expect(section.save()).rejects.toThrow(/imageUrl/);
  });
});
