/**
 * Customer-facing delivery text. The backend sends final values
 * (global + product): finalDeliveryFee, isFreeDelivery and deliveryTime.
 */
export const formatDeliveryFeeLabel = (fee) => {
  if (fee === undefined || fee === null || fee === "") return "";
  const n = Number(fee);
  if (!Number.isFinite(n)) return "";
  if (n <= 0) return "Free delivery";
  return `₹${Number.isInteger(n) ? n : n.toFixed(2)} delivery`;
};

export const getProductDeliveryFeeLabel = (product) =>
  formatDeliveryFeeLabel(product?.finalDeliveryFee);
