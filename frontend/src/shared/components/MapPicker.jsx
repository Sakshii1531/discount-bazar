import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Autocomplete,
} from "@react-google-maps/api";
import { Search, MapPin, Navigation, Loader2 } from "lucide-react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import Input from "./ui/Input";

const libraries = ["places"];
const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

const defaultCenter = {
  lat: 20.5937, // India center
  lng: 78.9629,
};

const AUTOCOMPLETE_OPTIONS = {
  componentRestrictions: { country: "IN" },
  fields: ["geometry", "formatted_address", "address_components", "name"],
};

const ADDRESS_COMPONENT_PRIORITY = {
  locality: [
    "sublocality_level_1",
    "sublocality",
    "neighborhood",
    "locality",
    "administrative_area_level_3",
  ],
  city: [
    "locality",
    "administrative_area_level_3",
    "administrative_area_level_2",
  ],
  state: ["administrative_area_level_1"],
  pincode: ["postal_code"],
};

const getAddressComponent = (components = [], types = []) => {
  const match = components.find((component) =>
    types.some((type) => component.types?.includes(type)),
  );
  return match?.long_name || "";
};

const cleanAddress = (rawAddress = "") => {
  if (!rawAddress || typeof rawAddress !== "string") return "";
  return rawAddress
    // Strip Plus Codes like "MVXJ+FM8, " or "MVXJ+FM8 "
    .replace(/^[A-Z0-9]{2,8}\+[A-Z0-9]{2,4}(?:,\s*|\s+)/i, "")
    // Strip any embedded Plus Codes like ", MVXJ+FM8, "
    .replace(/,\s*[A-Z0-9]{2,8}\+[A-Z0-9]{2,4}/gi, "")
    .trim();
};

const extractAddressDetails = (result) => {
  const components = result?.address_components || [];
  const locality =
    getAddressComponent(components, ADDRESS_COMPONENT_PRIORITY.locality) || "";
  const city =
    getAddressComponent(components, ADDRESS_COMPONENT_PRIORITY.city) || "";
  const state =
    getAddressComponent(components, ADDRESS_COMPONENT_PRIORITY.state) || "";
  const pincodeFromAddr = result?.formatted_address?.match(/\b\d{6}\b/)?.[0] || "";
  const pincode =
    getAddressComponent(components, ADDRESS_COMPONENT_PRIORITY.pincode) || pincodeFromAddr;

  return {
    locality,
    city,
    state,
    pincode,
  };
};

const MapPicker = ({
  isOpen,
  onClose,
  onConfirm,
  initialLocation = null,
  initialAddress = "",
  initialRadius = 5,
  maxRadius = 20,
  preferCurrentLocationOnOpen = false,
}) => {
  const [center, setCenter] = useState(initialLocation || defaultCenter);
  const [marker, setMarker] = useState(initialLocation);
  const [radius, setRadius] = useState(initialRadius);
  const [address, setAddress] = useState(cleanAddress(initialAddress));
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const mapRef = useRef(null);
  const autocompleteRef = useRef(null);
  const searchInputRef = useRef(null);
  const userSelectedLocationRef = useRef(false);
  const circleRef = useRef(null);
  const lastGeocodedPosRef = useRef(null);
  const addressDetailsRef = useRef(null);

  const clearCircleOverlay = useCallback(() => {
    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }
  }, []);

  const handleMapLoad = useCallback((mapInstance) => {
    mapRef.current = mapInstance;
  }, []);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
    libraries,
  });

  const applySelectedLocation = useCallback((lat, lng, formattedAddress = "", viewport = null) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    userSelectedLocationRef.current = true;
    clearCircleOverlay();
    const newPos = { lat, lng };
    setCenter(newPos);
    setMarker(newPos);
    if (formattedAddress) {
      setAddress(cleanAddress(formattedAddress));
    }
    if (mapRef.current) {
      if (viewport) {
        mapRef.current.fitBounds(viewport);
      } else {
        mapRef.current.panTo(newPos);
        mapRef.current.setCenter(newPos);
        mapRef.current.setZoom(16);
      }
    }
  }, [clearCircleOverlay]);

  const getCurrentLocation = useCallback(({
    silent = false,
    fallbackToInitial = false,
    force = false,
  } = {}) => {
    if (force) {
      userSelectedLocationRef.current = false;
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (userSelectedLocationRef.current && !force) {
            return;
          }
          clearCircleOverlay();
          const newPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setCenter(newPos);
          setMarker(newPos);
          if (mapRef.current) {
            mapRef.current.panTo(newPos);
            mapRef.current.setCenter(newPos);
          }
        },
        () => {
          if (userSelectedLocationRef.current && !force) return;
          if (fallbackToInitial && initialLocation) {
            setCenter(initialLocation);
            setMarker(initialLocation);
            if (mapRef.current) {
              mapRef.current.panTo(initialLocation);
              mapRef.current.setCenter(initialLocation);
            }
            return;
          }

          if (!silent) {
            alert("Unable to retrieve your location. Please select manually.");
          }
        },
      );
      return;
    }

    if (fallbackToInitial && initialLocation) {
      setCenter(initialLocation);
      setMarker(initialLocation);
      if (mapRef.current) {
        mapRef.current.panTo(initialLocation);
        mapRef.current.setCenter(initialLocation);
      }
      return;
    }

    if (!silent) {
      alert("Unable to retrieve your location. Please select manually.");
    }
  }, [clearCircleOverlay, initialLocation]);

  useEffect(() => {
    if (initialLocation && Number.isFinite(Number(initialLocation.lat)) && Number.isFinite(Number(initialLocation.lng))) {
      const pos = { lat: Number(initialLocation.lat), lng: Number(initialLocation.lng) };
      userSelectedLocationRef.current = true;
      setCenter(pos);
      setMarker(pos);
      if (mapRef.current) {
        mapRef.current.panTo(pos);
        mapRef.current.setCenter(pos);
      }
    }
  }, [initialLocation]);

  useEffect(() => {
    if (!isOpen) return;

    setRadius(initialRadius);

    if (initialLocation && Number.isFinite(Number(initialLocation.lat)) && Number.isFinite(Number(initialLocation.lng))) {
      const pos = { lat: Number(initialLocation.lat), lng: Number(initialLocation.lng) };
      userSelectedLocationRef.current = true;
      setCenter(pos);
      setMarker(pos);
      if (mapRef.current) {
        mapRef.current.panTo(pos);
        mapRef.current.setCenter(pos);
      }
      return;
    }

    userSelectedLocationRef.current = false;

    if (preferCurrentLocationOnOpen) {
      getCurrentLocation({ silent: true, fallbackToInitial: true });
      return;
    }

    setCenter(defaultCenter);
    setMarker(null);
  }, [isOpen, initialLocation, initialRadius, preferCurrentLocationOnOpen, getCurrentLocation]);

  const onMapClick = useCallback((e) => {
    userSelectedLocationRef.current = true;
    clearCircleOverlay();
    const newPos = {
      lat: e.latLng.lat(),
      lng: e.latLng.lng(),
    };
    setMarker(newPos);
  }, [clearCircleOverlay]);

  const onMarkerDragEnd = useCallback((e) => {
    userSelectedLocationRef.current = true;
    clearCircleOverlay();
    const newPos = {
      lat: e.latLng.lat(),
      lng: e.latLng.lng(),
    };
    setMarker(newPos);
  }, [clearCircleOverlay]);

  const handlePlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      if (place && place.geometry && place.geometry.location) {
        const lat =
          typeof place.geometry.location.lat === "function"
            ? place.geometry.location.lat()
            : Number(place.geometry.location.lat);
        const lng =
          typeof place.geometry.location.lng === "function"
            ? place.geometry.location.lng()
            : Number(place.geometry.location.lng);

        const cleanAddr = cleanAddress(place.formatted_address || place.name || "");
        lastGeocodedPosRef.current = { lat, lng };
        addressDetailsRef.current = {
          address: cleanAddr,
          ...extractAddressDetails(place),
        };

        applySelectedLocation(lat, lng, cleanAddr, place.geometry.viewport);
        return;
      }

      // If user typed and pressed Enter or place details lacked geometry, geocode text
      const query =
        place?.formatted_address ||
        place?.name ||
        searchInputRef.current?.value ||
        "";
      if (query && window.google?.maps?.Geocoder) {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode(
          { address: query, componentRestrictions: { country: "IN" } },
          (results, status) => {
            if (status === "OK" && results?.[0]?.geometry?.location) {
              const res = results[0];
              const loc = res.geometry.location;
              const lat =
                typeof loc.lat === "function" ? loc.lat() : Number(loc.lat);
              const lng =
                typeof loc.lng === "function" ? loc.lng() : Number(loc.lng);
              const cleanAddr = cleanAddress(res.formatted_address || query);
              lastGeocodedPosRef.current = { lat, lng };
              addressDetailsRef.current = {
                address: cleanAddr,
                ...extractAddressDetails(res),
              };
              applySelectedLocation(lat, lng, cleanAddr, res.geometry.viewport);
            }
          }
        );
      }
    }
  }, [applySelectedLocation]);

  useEffect(() => {
    return () => {
      clearCircleOverlay();
      mapRef.current = null;
    };
  }, [clearCircleOverlay]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !window.google?.maps) {
      return;
    }

    clearCircleOverlay();

    if (!marker) {
      return;
    }

    circleRef.current = new window.google.maps.Circle({
      map: mapRef.current,
      center: marker,
      radius: radius * 1000,
      fillColor: "var(--primary)",
      fillOpacity: 0.1,
      strokeColor: "var(--primary)",
      strokeOpacity: 0.5,
      strokeWeight: 2,
      clickable: false,
      editable: false,
      zIndex: 1,
    });

    return () => {
      clearCircleOverlay();
    };
  }, [isLoaded, marker, radius, clearCircleOverlay]);

  // Live reverse geocode marker position to human readable address
  useEffect(() => {
    if (!marker || !isLoaded || !window.google?.maps?.Geocoder) return;

    if (
      lastGeocodedPosRef.current &&
      Math.abs(lastGeocodedPosRef.current.lat - marker.lat) < 0.00001 &&
      Math.abs(lastGeocodedPosRef.current.lng - marker.lng) < 0.00001
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setIsFetchingAddress(true);
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ location: marker }, (results, status) => {
        setIsFetchingAddress(false);
        if (status === "OK" && results?.[0]) {
          const res = results[0];
          lastGeocodedPosRef.current = { lat: marker.lat, lng: marker.lng };
          const cleanAddr = cleanAddress(res.formatted_address || "");
          setAddress(cleanAddr);
          addressDetailsRef.current = {
            address: cleanAddr,
            ...extractAddressDetails(res),
          };
        }
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [marker, isLoaded]);

  const handleConfirm = async () => {
    if (!marker) {
      alert("Please select a location on the map.");
      return;
    }

    if (addressDetailsRef.current?.address) {
      onConfirm({
        ...marker,
        radius,
        ...addressDetailsRef.current,
      });
      onClose();
      return;
    }

    setIsGeocoding(true);
    try {
      const geocoder = new window.google.maps.Geocoder();
      const result = await new Promise((resolve, reject) => {
        geocoder.geocode({ location: marker }, (results, status) => {
          if (status === "OK") resolve(results[0]);
          else reject(status);
        });
      });

      const cleanAddr = cleanAddress(result.formatted_address || "");
      onConfirm({
        ...marker,
        radius,
        address: cleanAddr,
        ...extractAddressDetails(result),
      });
      onClose();
    } catch (error) {
      console.error("Geocoding failed:", error);
      onConfirm({
        ...marker,
        radius,
        address: cleanAddress(address) || "Custom Location",
      });
      onClose();
    } finally {
      setIsGeocoding(false);
    }
  };

  if (loadError) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Select Location">
        <div className="p-8 text-center text-red-500">
          Failed to load Google Maps. Please check your API key and connection.
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select Shop Location"
      size="md"
      footer={
        <div className="flex flex-col sm:flex-row justify-between w-full items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
            <MapPin className="w-4 h-4 text-brand-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-800 line-clamp-2" title={address}>
                {isFetchingAddress ? (
                  <span className="text-slate-400 font-normal inline-flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Fetching address...
                  </span>
                ) : address ? (
                  address
                ) : marker ? (
                  "Selected location"
                ) : (
                  "No location selected"
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end shrink-0">
            <Button variant="outline" onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-xl">
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={!marker || isGeocoding} className="px-5 py-2 text-xs font-black rounded-xl bg-slate-900 text-white">
              {isGeocoding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : null}
              Confirm Location
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-3.5">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1 min-w-0">
            {isLoaded && (
              <Autocomplete
                onLoad={(ref) => {
                  autocompleteRef.current = ref;
                }}
                onPlaceChanged={handlePlaceChanged}
                options={AUTOCOMPLETE_OPTIONS}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Search for your shop area..."
                    className="pl-9 pr-3 py-2 bg-slate-50 border-slate-200 text-xs sm:text-sm font-medium rounded-xl focus:bg-white"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setTimeout(handlePlaceChanged, 100);
                      }
                    }}
                  />
                </div>
              </Autocomplete>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => getCurrentLocation({ force: true })}
            className="h-9 w-9 rounded-xl shrink-0 border-slate-200"
            title="Use current location">
            <Navigation className="w-4 h-4 text-slate-700" />
          </Button>
        </div>

        <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-inner relative h-[220px] sm:h-[300px] w-full">
          {!isLoaded ? (
            <div className="h-full flex items-center justify-center bg-slate-50">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <GoogleMap
              onLoad={handleMapLoad}
              mapContainerStyle={mapContainerStyle}
              center={center}
              zoom={15}
              onClick={onMapClick}
              options={{
                disableDefaultUI: true,
                zoomControl: true,
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: false,
              }}>
              {marker && (
                <Marker
                  key={`${marker.lat.toFixed(6)}-${marker.lng.toFixed(6)}`}
                  position={marker}
                  draggable={true}
                  onDragEnd={onMarkerDragEnd}
                  animation={window.google.maps.Animation.DROP}
                />
              )}
            </GoogleMap>
          )}
        </div>

        <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 space-y-2.5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-bold text-slate-700">
              Service Radius (km)
            </label>
            <span className="text-xs font-black text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md border border-brand-100">{radius} km</span>
          </div>
          <input
            type="range"
            min="1"
            max={maxRadius}
            step="1"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
          />
          <div className="flex justify-between text-[10px] font-bold text-slate-400">
            <span>1 km</span>
            <span>{maxRadius} km</span>
          </div>
          <p className="text-[11px] text-slate-500 font-medium flex items-start gap-1">
            <MapPin className="w-3 h-3 text-brand-600 mt-0.5 shrink-0" />
            Customers within this radius from your shop will be able to see and order from you.
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default MapPicker;
