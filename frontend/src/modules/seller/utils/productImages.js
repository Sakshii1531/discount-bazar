const isNewImage = (image) => typeof image === "string" && image.startsWith("data:");

export const dataURLtoFile = (dataurl, filename) => {
  if (typeof File !== "undefined" && dataurl instanceof File) return dataurl;
  if (!isNewImage(dataurl)) return null;
  try {
    const [header, base64] = dataurl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
    const cleanBase64 = String(base64 || "").replace(/[\r\n\s]/g, "");
    const binary = atob(cleanBase64);
    const len = binary.length;
    const rawBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      rawBytes[i] = binary.charCodeAt(i);
    }
    return new File([rawBytes], filename, { type: mime });
  } catch (err) {
    console.warn("Failed to convert image:", err);
    return null;
  }
};

/**
 * Adds a saved product's photo changes to its update form. In the form's state
 * a saved photo is its URL and a newly picked one is a data URL.
 */
export const appendProductImageEdits = (data, { mainImage, galleryImages }, savedMainImage) => {
  const mainFile = dataURLtoFile(mainImage, "main-image.jpg");
  if (mainFile) {
    data.append("mainImage", mainFile);
  } else if (!mainImage && savedMainImage) {
    data.append("removeMainImage", "true");
  }

  const layout = (galleryImages || []).map((image, i) => {
    const file = dataURLtoFile(image, `gallery_${i + 1}.jpg`);
    if (!file) return image;
    data.append("galleryImages", file);
    return "new";
  });
  data.append("galleryLayout", JSON.stringify(layout));
};
