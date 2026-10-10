// Customer routes for catalogue pages (see routes/index.jsx).

export const brandPath = (brandName) =>
  `/brand/${encodeURIComponent(String(brandName || "").trim())}`;

export const productPath = (product) =>
  `/product/${encodeURIComponent(String(product?._id || product?.id || "").trim())}`;
