import handleResponse from "../utils/helper.js";
import { geocodeAddress, geocodePlaceId, reverseGeocode } from "../services/mapsGeocodeService.js";

export const geocodeAddressController = async (req, res) => {
  try {
    const address = String(req.query.address || "").trim();
    const placeId = String(req.query.placeId || "").trim();
    const country = req.query.country ? String(req.query.country).trim() : undefined;

    if (!placeId && (!address || address.length < 3)) {
      return handleResponse(res, 400, "address or placeId query param is required", {
        error: { code: "ADDRESS_REQUIRED", message: "address query param is required" },
      });
    }

    const result = placeId
      ? await geocodePlaceId(placeId)
      : await geocodeAddress(address, { country });

    return handleResponse(res, 200, "Geocoded", {
      location: { lat: result.lat, lng: result.lng },
      formattedAddress: result.formattedAddress,
      placeId: result.placeId,
      types: result.types,
      city: result.city || "",
      state: result.state || "",
      pincode: result.pincode || "",
    });
  } catch (e) {
    const status = e.statusCode || 500;
    return handleResponse(res, status, e.message || "Geocoding failed", {
      error: {
        code: e.code || "GEOCODE_FAILED",
        message: e.message || "Geocoding failed",
      },
    });
  }
};

export const reverseGeocodeController = async (req, res) => {
  try {
    const result = await reverseGeocode(req.query.lat, req.query.lng);
    return handleResponse(res, 200, "Reverse geocoded", result);
  } catch (e) {
    const status = e.statusCode || 500;
    return handleResponse(res, status, e.message || "Reverse geocoding failed", {
      error: {
        code: e.code || "REVERSE_GEOCODE_FAILED",
        message: e.message || "Reverse geocoding failed",
      },
    });
  }
};
