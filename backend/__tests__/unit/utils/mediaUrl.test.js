import { isMediaUrl, isLocalUploadPath, normalizeMediaUrl, absoluteMediaUrl } from "../../../app/utils/mediaUrl.js";

describe("media URL validation", () => {
  it("accepts http(s) URLs and this server's /uploads paths", () => {
    expect(isMediaUrl("https://cdn.example.test/a.jpg")).toBe(true);
    expect(isMediaUrl("http://x.test/a.png")).toBe(true);
    expect(isMediaUrl("/uploads/products/1731400000-abc123.jpg")).toBe(true);
    expect(isMediaUrl("  /uploads/categories/sub-dir/a_b.webp  ")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      null,
      undefined,
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "/etc/passwd",
      "uploads/products/a.jpg",
      "/uploads/../index.js",
      "/uploads//evil.jpg",
      "/uploads/a b.jpg",
      "//evil.test/uploads/a.jpg",
    ]) {
      expect(isMediaUrl(bad)).toBe(false);
    }
    expect(isLocalUploadPath("https://cdn.example.test/uploads/a.jpg")).toBe(false);
  });

  it("normalizes to the trimmed value or empty", () => {
    expect(normalizeMediaUrl(" /uploads/products/a.jpg ")).toBe("/uploads/products/a.jpg");
    expect(normalizeMediaUrl("not a url")).toBe("");
  });

  it("builds absolute URLs for emails from the configured backend URL", () => {
    const prev = process.env.BACKEND_URL;
    const prevServer = process.env.SERVER_URL;
    try {
      process.env.BACKEND_URL = "https://discountbazaar.co.in/";
      expect(absoluteMediaUrl("/uploads/settings/logo.png")).toBe("https://discountbazaar.co.in/uploads/settings/logo.png");
      expect(absoluteMediaUrl("https://cdn.example.test/l.png")).toBe("https://cdn.example.test/l.png");
      expect(absoluteMediaUrl("data:x")).toBe("");
      delete process.env.BACKEND_URL;
      delete process.env.SERVER_URL;
      expect(absoluteMediaUrl("/uploads/settings/logo.png")).toBe("");
    } finally {
      if (prev === undefined) delete process.env.BACKEND_URL;
      else process.env.BACKEND_URL = prev;
      if (prevServer === undefined) delete process.env.SERVER_URL;
      else process.env.SERVER_URL = prevServer;
    }
  });
});
