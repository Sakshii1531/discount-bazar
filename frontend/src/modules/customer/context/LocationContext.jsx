import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { customerApi } from "../services/customerApi";
import { hasValidStoredAuthToken } from "@core/utils/authStorage";
import { getJSON, setJSON, STORAGE_KEYS } from "@core/utils/storage";

const LocationContext = createContext(undefined);
const STORAGE_KEY = STORAGE_KEYS.LOCATION;
// 30 days — refresh the cached coordinates if a user comes back to a stale tab
// after roughly a month so we don't keep serving locations from a previous
// address indefinitely.
const LOCATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Placeholder shown until the user's real location is detected or chosen.
export const PLACEHOLDER_LOCATION_NAME = "Select delivery location";
// Placeholder state: no city/state/coords are assumed for the user.
const EMPTY_LOCATION = Object.freeze({
  name: PLACEHOLDER_LOCATION_NAME,
  time: "12-15 mins",
  city: "",
  state: "",
  pincode: "",
  latitude: null,
  longitude: null,
});
const isRealLocationName = (name) =>
  !!name && name !== PLACEHOLDER_LOCATION_NAME && !name.includes("Rajshri Palace");

export const LocationProvider = ({ children }) => {
  // No location until the user's real one is detected, restored or chosen.
  const [currentLocation, setCurrentLocation] = useState(EMPTY_LOCATION);

  // Address list for drawer UI – will be hydrated from profile API.
  const [savedAddresses, setSavedAddresses] = useState([]);

  const [isFetchingLocation, setIsFetchingLocation] = useState(() => {
    const stored = getJSON(STORAGE_KEY, null);
    return !isRealLocationName(stored?.address || stored?.name);
  });
  const [locationError, setLocationError] = useState(null);

  // Update the current location.
  // By default this does NOT change saved addresses; only explicit
  // address actions should touch the saved list.
  const updateLocation = (
    newLoc,
    { persist = true, updateSavedHome = false } = {},
  ) => {
    setCurrentLocation(newLoc);

    if (updateSavedHome) {
      setSavedAddresses((prev) =>
        prev.map((addr) =>
          addr.label === "Home" ? { ...addr, address: newLoc.name } : addr,
        ),
      );
    }

    if (persist) {
      const payload = {
        address: newLoc.name,
        city: newLoc.city,
        state: newLoc.state,
        pincode: newLoc.pincode,
        latitude: newLoc.latitude,
        longitude: newLoc.longitude,
        // Internal app properties
        time: newLoc.time,
      };
      setJSON(STORAGE_KEY, payload, { ttlMs: LOCATION_TTL_MS });
    }
  };

  const addAddress = (newAddress) => {
    setSavedAddresses((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        label: newAddress.label || "Other",
        address: newAddress.address,
        phone: newAddress.phone || "N/A",
        isCurrent: false,
      },
    ]);
  };

  // Resolve location once using browser geolocation + Google Maps Geocoding.
  // Must be called directly from a user gesture (click/tap) for the browser to show the permission prompt.
  const fetchAndCacheLocation = () =>
    new Promise((resolve) => {
      if (
        typeof window === "undefined" ||
        !("navigator" in window) ||
        !navigator.geolocation
      ) {
        const message = "Geolocation is not supported on this device";
        setLocationError(message);
        setIsFetchingLocation(false);
        resolve({ ok: false, error: message });
        return;
      }

      setIsFetchingLocation(true);
      setLocationError(null);

      // Used only when every reverse-geocoding source fails: keep the real
      // coordinates (needed for delivery fee / nearby sellers) but never invent
      // a city or state.
      const fallbackFromCoords = (latitude, longitude) => ({
        name: `Lat ${Number(latitude).toFixed(5)}, Lng ${Number(longitude).toFixed(5)}`,
        time: "12-15 mins",
        city: "",
        state: "",
        pincode: "",
        latitude,
        longitude,
      });

      // Primary: backend proxy (server-side Google key, Nominatim fallback).
      const reverseGeocodeViaServer = async (latitude, longitude) => {
        try {
          const { data } = await customerApi.reverseGeocode(latitude, longitude);
          const r = data?.result;
          const name = r?.displayName || r?.formattedAddress;
          if (!name) return null;
          return {
            name,
            time: "12-15 mins",
            city: r.city || "",
            state: r.state || "",
            pincode: r.pincode || "",
            latitude,
            longitude,
          };
        } catch {
          return null;
        }
      };

      // Secondary: keyless OpenStreetMap lookup straight from the browser, in
      // case the backend is unreachable.
      const reverseGeocodeWithOSM = async (latitude, longitude) => {
        try {
          const params = new URLSearchParams({
            format: "jsonv2",
            lat: String(latitude),
            lon: String(longitude),
            addressdetails: "1",
          });
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
            { headers: { "Accept-Language": "en" } },
          );
          if (!response.ok) return null;
          const data = await response.json();
          const addr = data?.address;
          if (!addr) return null;

          const area =
            addr.neighbourhood || addr.suburb || addr.quarter || addr.residential;
          const road = addr.road;
          const city =
            addr.city || addr.town || addr.village || addr.municipality ||
            addr.county || addr.state_district;
          const state = addr.state || addr.territory;
          const pincode = addr.postcode;

          const displayParts = [];
          if (addr.house_number) displayParts.push(addr.house_number);
          if (road) displayParts.push(road);
          if (area && area !== road) displayParts.push(area);
          if (city) displayParts.push(city);
          let statePincode = "";
          if (state) statePincode += state;
          if (pincode) statePincode += (statePincode ? " " : "") + pincode;
          if (statePincode) displayParts.push(statePincode);
          if (addr.country) displayParts.push(addr.country);

          const name = displayParts.join(", ") || data.display_name;
          if (!name) return null;

          return {
            name,
            time: "12-15 mins",
            city: city || "",
            state: state || "",
            pincode: pincode || "",
            latitude,
            longitude,
          };
        } catch {
          return null;
        }
      };

      const handleLocationSuccess = async (latitude, longitude) => {
        try {
          // Always succeed with coordinates (needed for delivery fee calculation),
          // even if reverse geocoding fails.
          const resolved =
            (await reverseGeocodeViaServer(latitude, longitude)) ||
            (await reverseGeocodeWithOSM(latitude, longitude));
          const liveLocation = resolved || fallbackFromCoords(latitude, longitude);

          updateLocation(liveLocation, {
            persist: true,
            updateSavedHome: false,
          });
          resolve(
            resolved
              ? { ok: true, location: liveLocation }
              : { ok: true, location: liveLocation, warning: "Unable to fetch address" },
          );
        } finally {
          setIsFetchingLocation(false);
        }
      };

      const handleLocationError = (error) => {
        const message = typeof error === 'string' ? error : (error.message || "Location permission denied");
        setLocationError(message);
        setIsFetchingLocation(false);
        resolve({ ok: false, error: message });
      };

      // Native Flutter Bridge
      if (window.Flutter) {
        import("../../../lib/turboCartBridge").then(async (m) => {
          const TurboCartBridge = m.default;
          const coords = await TurboCartBridge.getLocation();
          if (coords && coords.lat && coords.lng) {
            handleLocationSuccess(coords.lat, coords.lng);
          } else {
            handleLocationError("Native location failed");
          }
        }).catch(() => handleLocationError("Bridge not found"));
        return;
      }

      // Standard Browser Geolocation
      navigator.geolocation.getCurrentPosition(
        (position) => handleLocationSuccess(position.coords.latitude, position.coords.longitude),
        handleLocationError,
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        },
      );
    });

  const refreshAddresses = useCallback(async () => {
    // Skip if user is not logged in – getProfile would 401 and trigger axios reload loop
    if (!hasValidStoredAuthToken("auth_customer")) return;
    try {
      const { data } = await customerApi.getProfile();
      const profile = data?.result ?? data?.data ?? data;
      const raw = Array.isArray(profile?.addresses) ? profile.addresses : [];
      const mappedAddresses = raw.map((addr, idx) => ({
        id: addr._id ?? String(idx),
        label:
          (addr.label || "Home").charAt(0).toUpperCase() +
          (addr.label || "home").slice(1),
        address:
          addr.fullAddress ||
          [addr.landmark, addr.city, addr.state, addr.pincode]
            .filter(Boolean)
            .join(", ") ||
          "",
        city: addr.city || "",
        state: addr.state || "",
        pincode: addr.pincode || "",
        location:
          addr?.location &&
          typeof addr.location.lat === "number" &&
          typeof addr.location.lng === "number" &&
          Number.isFinite(addr.location.lat) &&
          Number.isFinite(addr.location.lng)
            ? { lat: addr.location.lat, lng: addr.location.lng }
            : null,
        placeId: typeof addr?.placeId === "string" ? addr.placeId : null,
        phone: profile?.phone ?? "",
        isCurrent: idx === 0,
      }));
      setSavedAddresses(mappedAddresses);

      // Auto-set user's primary saved address if available and current location is default/Rajshri Palace
      if (mappedAddresses.length > 0) {
        const primary = mappedAddresses[0];
        if (primary.address) {
          const stored = getJSON(STORAGE_KEY, null);
          const storedName = stored?.address || stored?.name || "";
          if (!stored || !storedName || storedName.includes("Rajshri Palace") || storedName === "Select delivery location") {
            const newLoc = {
              name: primary.address,
              time: "12-15 mins",
              city: primary.city || "",
              state: primary.state || "",
              pincode: primary.pincode || "",
              latitude: primary.location?.lat ?? null,
              longitude: primary.location?.lng ?? null,
            };
            setCurrentLocation(newLoc);
            setJSON(STORAGE_KEY, { address: newLoc.name, ...newLoc }, { ttlMs: LOCATION_TTL_MS });
          }
        }
      }
    } catch {
      // If API fails, keep existing in-memory addresses.
    }
  }, []);

  // On mount: hydrate saved addresses from profile (only when customer is logged in)
  useEffect(() => {
    refreshAddresses();
  }, [refreshAddresses]);

  // On mount: restore a real cached location, otherwise try to detect it.
  // The placeholder/default coords are never persisted, so a refresh retries
  // detection instead of treating the default as the user's location.
  useEffect(() => {
    const parsed = getJSON(STORAGE_KEY, null);
    const addressName = parsed?.address || parsed?.name;
    if (parsed && isRealLocationName(addressName)) {
      updateLocation(
        {
          name: addressName,
          time: parsed.time || "12-15 mins",
          city: parsed.city,
          state: parsed.state,
          pincode: parsed.pincode,
          latitude: parsed.latitude,
          longitude: parsed.longitude,
        },
        { persist: false, updateSavedHome: false },
      );
      // A coordinate-only name means reverse geocoding failed last time (and
      // older builds stored a hardcoded city/state with it) — resolve it again.
      if (/^Lat -?\d/.test(addressName) || !parsed.state) {
        fetchAndCacheLocation();
      }
    } else {
      fetchAndCacheLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locationValue = useMemo(() => ({
    currentLocation,
    savedAddresses,
    updateLocation,
    addAddress,
    refreshAddresses,
    isFetchingLocation,
    locationError,
    isLocationResolved: isRealLocationName(currentLocation?.name),
    refreshLocation: fetchAndCacheLocation,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentLocation, savedAddresses, isFetchingLocation, locationError, refreshAddresses]);

  return (
    <LocationContext.Provider value={locationValue}>
      {children}
    </LocationContext.Provider>
  );
};

const defaultLocationContext = {
  currentLocation: EMPTY_LOCATION,
  savedAddresses: [],
  isFetchingLocation: false,
  locationError: null,
  isLocationResolved: false,
  updateLocation: () => {},
  requestCurrentLocation: () => {},
  refreshAddresses: async () => [],
};

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (context === undefined || context === null) {
    return defaultLocationContext;
  }
  return context;
};
