const isNewImage = (image) => typeof image === "string" && image.startsWith("data:");

export const dataURLtoFile = (dataurl, filename) => {
  if (!isNewImage(dataurl)) return null;
  try {
    const [header, base64] = dataurl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new File([bytes], filename, { type: mime });
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
