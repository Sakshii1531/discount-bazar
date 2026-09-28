import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api";
import { Loader2 } from "lucide-react";
import customerPin from "@/assets/customer-pin.png";
import { deliveryApi } from "../services/deliveryApi";
import deliveryIcon from "@/assets/deliveryIcon.png";
import storePin from "@/assets/store-pin.png";
import {
  getCachedDeliveryPartnerLocation,
  saveDeliveryPartnerLocation,
} from "../utils/deliveryLastLocation";
import {
  ROUTE_TRACKING,
  snapToRoute,
  remainingPath,
  pathLengthMeters,
  toLatLngLiteral,
} from "@shared/utils/routeGeometry";

const libraries = ["geometry"];
// Periodic refresh keeps traffic-based ETA current; movement-based rerouting is
// handled separately (off-route detection below), so this can be relaxed.
const ROUTE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const RECENTER_INTERVAL_MS = 15000;
const RIDER_FOCUS_RADIUS_M = 500;
const LOCATION_POST_INTERVAL_MS = 5000;

// Container style will be 100% to fill parent
const containerStyle = {
  width: "100%",
  height: "100%",
  minHeight: "200px",
};

/** GeoJSON [lng, lat] → { lat, lng } */
function coordsToLatLng(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function destinationForPhase(order, phase) {
  const isReturn = Boolean(
    order?.returnStatus &&
      !["none", "return_requested", "return_rejected"].includes(
        String(order.returnStatus).toLowerCase()
      )
  );
  if (phase === "pickup") {
    if (isReturn) {
      const loc = order?.address?.location;
      if (
        loc &&
        typeof loc.lat === "number" &&
        typeof loc.lng === "number" &&
        Number.isFinite(loc.lat) &&
        Number.isFinite(loc.lng)
      ) {
        return { lat: loc.lat, lng: loc.lng };
      }
      return null;
    }
    return coordsToLatLng(order?.seller?.location?.coordinates);
  }
  if (isReturn) {
    return coordsToLatLng(order?.seller?.location?.coordinates);
  }
  const loc = order?.address?.location;
  if (
    loc &&
    typeof loc.lat === "number" &&
    typeof loc.lng === "number" &&
    Number.isFinite(loc.lat) &&
    Number.isFinite(loc.lng)
  ) {
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}

/**
 * Live tracking map: rider + one road route from GET /orders/workflow/:orderId/route.
 * Uses a single native google.maps.Polyline (ref) so the React wrapper cannot leave
 * duplicate overlays. No geodesic rider→dest line — that caused a second “straight” path.
 */
const DeliveryTrackingMapComponent = ({
  orderId,
  phase,
  order,
  onRouteStatsChange,
}) => {
  const mapRef = useRef(null);
  const routePolylineRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [rider, setRider] = useState(() => {
    const c = getCachedDeliveryPartnerLocation();
    return c ? { lat: c.lat, lng: c.lng } : null;
  });
  // Initialize riderRef from cache so fetchRoute works immediately on mount
  const riderRef = useRef((() => {
    const c = getCachedDeliveryPartnerLocation();
    return c ? { lat: c.lat, lng: c.lng } : null;
  })());
  const [routeData, setRouteData] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const lastFetchRef = useRef({ at: 0, phase: null, orderId: null });
  const routeOriginRef = useRef(null);
  // Snapping / off-route state (refs: updated on every GPS fix without re-renders)
  const snapHintRef = useRef(0);
  const offRouteFixesRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const watchIdRef = useRef(null);
  const lastLocationPostRef = useRef(0);
  const locationInFlightRef = useRef(false);
  const locationAbortRef = useRef(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

  const { isLoaded, loadError } = useJsApiLoader({
    id: "delivery-tracking-map",
    googleMapsApiKey: apiKey,
    libraries,
  });

  useEffect(() => {
    if (!navigator.geolocation) return undefined;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        const heading = pos.coords.heading;
        const speed = pos.coords.speed;

        saveDeliveryPartnerLocation(lat, lng);
        setRider({ lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null });
        riderRef.current = { lat, lng };
        
        // Throttle location POSTs to once every 5s and skip if one is already in-flight
        const now = Date.now();
        if (now - lastLocationPostRef.current < LOCATION_POST_INTERVAL_MS) return;
        if (locationInFlightRef.current) return;
        lastLocationPostRef.current = now;
        locationInFlightRef.current = true;

        // Abort any previous stale request
        if (locationAbortRef.current) locationAbortRef.current.abort();
        const controller = new AbortController();
        locationAbortRef.current = controller;

        deliveryApi.postLocation(
          { lat, lng, accuracy, heading, speed, orderId: orderId || null },
          { signal: controller.signal, timeout: 8000 },
        ).catch(() => {}).finally(() => {
          locationInFlightRef.current = false;
          if (locationAbortRef.current === controller) locationAbortRef.current = null;
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (locationAbortRef.current) {
        locationAbortRef.current.abort();
        locationAbortRef.current = null;
      }
      locationInFlightRef.current = false;
    };
  }, [orderId]);

  const routeAbortRef = useRef(null);
  const routeInFlightRef = useRef(false);

  /**
   * Fetch the road route from the rider's current position.
   * `reroute` = rider has left the drawn route → server skips its caches.
   * Without `reroute`, a recent route for the same order/phase is kept (the
   * drawn line is trimmed locally as the rider moves along it).
   */
  const fetchRoute = useCallback(async ({ reroute = false } = {}) => {
    const currentRider = riderRef.current;
    if (!orderId || !currentRider) return;
    if (routeInFlightRef.current) return;
    const now = Date.now();
    const sameRouteContext =
      lastFetchRef.current.phase === phase &&
      lastFetchRef.current.orderId === orderId;

    if (
      !reroute &&
      sameRouteContext &&
      lastFetchRef.current.at &&
      now - lastFetchRef.current.at < ROUTE_REFRESH_INTERVAL_MS
    ) {
      return;
    }

    lastFetchRef.current = { at: now, phase, orderId };
    routeInFlightRef.current = true;

    if (routeAbortRef.current) routeAbortRef.current.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;

    setRouteLoading(true);
    try {
      const res = await deliveryApi.getOrderRoute(orderId, {
        phase,
        originLat: currentRider.lat,
        originLng: currentRider.lng,
        ...(reroute ? { reroute: 1 } : {}),
        _t: now,
      }, { signal: controller.signal });
      if (res.data?.success) {
        const nextRoute = res.data.result || res.data.data || null;
        setRouteData(nextRoute);
        routeOriginRef.current = { lat: currentRider.lat, lng: currentRider.lng };
        snapHintRef.current = 0;
        offRouteFixesRef.current = 0;
      }
    } catch {
      setRouteData((prev) => prev || { degraded: true });
    } finally {
      routeInFlightRef.current = false;
      if (routeAbortRef.current === controller) routeAbortRef.current = null;
      setRouteLoading(false);
    }
  // Stable — uses riderRef so GPS ticks don't recreate this callback
  }, [orderId, phase]);

  useEffect(() => {
    setRouteData((prev) => (prev?.phase === phase ? prev : null));
    lastFetchRef.current = { at: 0, phase: null, orderId: null };
    routeOriginRef.current = null;
  }, [orderId, phase]);

  useEffect(() => {
    if (!rider) return undefined;
    fetchRoute();
    const iv = setInterval(fetchRoute, ROUTE_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(iv);
      if (routeAbortRef.current) {
        routeAbortRef.current.abort();
        routeAbortRef.current = null;
      }
      routeInFlightRef.current = false;
    };
  // rider in deps only to trigger initial fetch when location first becomes available
  // fetchRoute is stable (doesn't depend on rider state)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!rider, fetchRoute, phase, orderId]);

  const isReturn = Boolean(
    order?.returnStatus &&
      !["none", "return_requested", "return_rejected"].includes(
        String(order.returnStatus).toLowerCase()
      )
  );
  // The server decides the leg from the order status; trust it over the local step
  // so the drawn route and the destination pin always point the same way.
  const effectivePhase = routeData?.phase === "pickup" || routeData?.phase === "delivery"
    ? routeData.phase
    : phase;

  // Use order address location, fall back to the destination resolved by the route API
  const dest = useMemo(() => {
    const fromOrder = destinationForPhase(order, effectivePhase);
    if (fromOrder) return fromOrder;
    // routeData may contain the resolved destination (set by backend geocode fallback)
    const rd = routeData?.destination;
    if (rd && typeof rd.lat === "number" && typeof rd.lng === "number") {
      return { lat: rd.lat, lng: rd.lng };
    }
    return null;
  }, [order, effectivePhase, routeData]);

  const decodedPath = useMemo(() => {
    const encoded = routeData?.polyline;
    if (!encoded || !isLoaded || !mapInstance) return null;
    try {
      const decode = window.google?.maps?.geometry?.encoding?.decodePath;
      if (!decode) return null;
      return decode(encoded).map(toLatLngLiteral).filter(Boolean);
    } catch {
      return null;
    }
  }, [routeData?.polyline, isLoaded, mapInstance]);

  // Snap the GPS fix onto the route (GPS drifts 15–50 m; the rider is on the road).
  const snap = useMemo(() => {
    if (!rider || !decodedPath?.length) return null;
    const s = snapToRoute(decodedPath, rider, snapHintRef.current);
    if (s) snapHintRef.current = s.segmentIndex;
    return s;
  }, [rider, decodedPath]);
  const isOnRoute = Boolean(snap && snap.distance <= ROUTE_TRACKING.OFF_ROUTE_M);
  // Marker and remaining line share one rule: on-route → both drawn on the road.
  const isSnapped = isOnRoute;

  /** Rider position as drawn: on the road when close enough, raw GPS otherwise. */
  const displayRider = isSnapped ? snap.point : rider ? { lat: rider.lat, lng: rider.lng } : null;

  /** Only the road still ahead (travelled part trimmed); full route while off-route. */
  const linePath = useMemo(() => {
    if (!decodedPath?.length) return [];
    return isOnRoute ? remainingPath(decodedPath, snap) : decodedPath;
  }, [decodedPath, isOnRoute, snap]);

  // Off-route: consecutive fixes far from the line → rider took another road → reroute.
  useEffect(() => {
    if (!rider || !decodedPath?.length || !snap) return;
    if (snap.distance > ROUTE_TRACKING.OFF_ROUTE_M) {
      offRouteFixesRef.current += 1;
    } else {
      offRouteFixesRef.current = 0;
      return;
    }
    const now = Date.now();
    if (
      offRouteFixesRef.current >= ROUTE_TRACKING.OFF_ROUTE_FIXES &&
      now - lastRerouteAtRef.current >= ROUTE_TRACKING.REROUTE_MIN_INTERVAL_MS
    ) {
      lastRerouteAtRef.current = now;
      offRouteFixesRef.current = 0;
      fetchRoute({ reroute: true });
    }
  }, [rider, decodedPath, snap, fetchRoute]);

  // Remaining distance / ETA shrink as the rider progresses along the route.
  const remainingStats = useMemo(() => {
    const totalM = Number(routeData?.distanceMeters ?? routeData?.distance) || null;
    const totalS = Number(routeData?.duration) || null;
    if (!decodedPath?.length || !isOnRoute) return { meters: totalM, seconds: totalS };
    const fullLen = pathLengthMeters(decodedPath);
    const leftLen = pathLengthMeters(linePath);
    if (!fullLen) return { meters: totalM, seconds: totalS };
    const ratio = Math.max(0, Math.min(1, leftLen / fullLen));
    return {
      meters: totalM ? Math.round(totalM * ratio) : Math.round(leftLen),
      seconds: totalS ? Math.round(totalS * ratio) : null,
    };
  }, [routeData, decodedPath, linePath, isOnRoute]);

  useEffect(() => {
    if (typeof onRouteStatsChange !== "function") return undefined;
    onRouteStatsChange({
      phase: effectivePhase,
      rider,
      destination: dest,
      routeDurationSeconds: remainingStats.seconds || null,
      routeDistanceMeters: remainingStats.meters || null,
    });
    return undefined;
  }, [onRouteStatsChange, effectivePhase, rider, dest, remainingStats]);

  const riderMarkerIcon = useMemo(() => {
    if (!isLoaded || !window.google?.maps) return undefined;

    return {
      url: deliveryIcon,
      scaledSize: new window.google.maps.Size(44, 64),
      // Vehicle icon is centred on its position (pins use a bottom anchor, a vehicle does not)
      anchor: new window.google.maps.Point(22, 32),
    };
  }, [isLoaded]);

  const customerMarkerIcon = useMemo(() => {
    if (!isLoaded || !window.google?.maps) return undefined;

    return {
      url: customerPin,
      scaledSize: new window.google.maps.Size(40, 40),
      anchor: new window.google.maps.Point(20, 40),
    };
  }, [isLoaded]);

  const storeMarkerIcon = useMemo(() => {
    if (!isLoaded || !window.google?.maps) return undefined;

    return {
      url: storePin,
      scaledSize: new window.google.maps.Size(40, 40),
      anchor: new window.google.maps.Point(20, 40),
    };
  }, [isLoaded]);

  const mapCenter = useMemo(() => {
    if (displayRider) return displayRider;
    if (dest) return dest;
    return { lat: 20.5937, lng: 78.9629 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRider?.lat, displayRider?.lng, dest]);

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
    setMapInstance(map);
  }, []);

  const focusOnRider500m = useCallback((map, riderLocation) => {
    if (!map || !window.google?.maps?.geometry?.spherical || !riderLocation) return;

    const center = new window.google.maps.LatLng(riderLocation.lat, riderLocation.lng);
    const bounds = new window.google.maps.LatLngBounds();
    [0, 90, 180, 270].forEach((heading) => {
      const edge = window.google.maps.geometry.spherical.computeOffset(
        center,
        RIDER_FOCUS_RADIUS_M,
        heading,
      );
      bounds.extend(edge);
    });
    map.fitBounds(bounds, 24);
  }, []);

  const strokeColor = "#2563eb";

  useEffect(() => {
    if (!isLoaded || !mapInstance || !window.google?.maps) return undefined;

    // Clear previous polyline
    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
      routePolylineRef.current = null;
    }

    if (!linePath?.length) return undefined;

    const pl = new window.google.maps.Polyline({
      path: linePath,
      strokeColor: "#2563eb",
      strokeOpacity: 0.95,
      strokeWeight: 5,
      map: mapInstance,
      zIndex: 10,
    });
    routePolylineRef.current = pl;

    return () => {
      if (routePolylineRef.current) {
        routePolylineRef.current.setMap(null);
        routePolylineRef.current = null;
      }
    };
  }, [isLoaded, mapInstance, linePath]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;

    if (displayRider) {
      focusOnRider500m(map, displayRider);
      return;
    }

    try {
      const bounds = new window.google.maps.LatLngBounds();
      if (linePath?.length) {
        linePath.forEach((p) => bounds.extend(p));
      }
      if (dest) bounds.extend(dest);
      map.fitBounds(bounds, 32);
    } catch {
      /* ignore */
    }
    // Re-fit on route/phase changes, not on every GPS fix (the recenter timer follows the rider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodedPath, !!displayRider, dest, focusOnRider500m]);

  // Smoothly keep rider centered and zoomed to 500m view.
  useEffect(() => {
    if (!isLoaded || !rider) return undefined;
    const map = mapRef.current;
    if (!map) return undefined;

    const id = setInterval(() => {
      const currentMap = mapRef.current;
      if (!currentMap || !displayRider) return;
      currentMap.panTo(displayRider);
      focusOnRider500m(currentMap, displayRider);
    }, RECENTER_INTERVAL_MS);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, displayRider?.lat, displayRider?.lng, focusOnRider500m]);

  // Add resize observer to handle dynamic height changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google) return undefined;

    const handleResize = () => {
      window.google.maps.event.trigger(map, 'resize');
      // Re-focus rider after resize when available
      try {
        if (displayRider) {
          focusOnRider500m(map, displayRider);
          return;
        }
        const bounds = new window.google.maps.LatLngBounds();
        if (linePath?.length) {
          linePath.forEach((p) => bounds.extend(p));
        }
        if (dest) bounds.extend(dest);
        map.fitBounds(bounds, 32);
      } catch {
        /* ignore */
      }
    };

    // Listen for window resize events
    window.addEventListener('resize', handleResize);
    
    // Create a resize observer for the map container
    const mapContainer = map.getDiv()?.parentElement;
    let resizeObserver;
    
    if (mapContainer && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(mapContainer);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodedPath, !!displayRider, dest, focusOnRider500m]);

  if (!apiKey) {
    return (
      <div className="relative w-full h-48 bg-slate-100 rounded-2xl flex items-center justify-center text-center px-4">
        <p className="text-xs text-slate-500">
          Set <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> to show live
          tracking.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="relative w-full h-48 bg-rose-50 rounded-2xl flex items-center justify-center text-xs text-rose-700 px-4">
        Map failed to load. Check the API key and billing.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="relative w-full h-48 bg-slate-50 rounded-2xl flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-100">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={mapCenter}
        zoom={14}
        onLoad={onMapLoad}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        }}
      >
        {displayRider && (
          <Marker
            position={displayRider}
            title="Your location"
            icon={riderMarkerIcon}
          />
        )}
        {dest && (
          <Marker
            position={dest}
            title={
              effectivePhase === "pickup"
                ? isReturn
                  ? "Pickup (customer)"
                  : "Pickup (store)"
                : isReturn
                  ? "Drop (seller)"
                  : "Drop (customer)"
            }
            icon={
              effectivePhase === "pickup"
                ? isReturn
                  ? customerMarkerIcon
                  : storeMarkerIcon
                : isReturn
                  ? storeMarkerIcon
                  : customerMarkerIcon
            }
          />
        )}
      </GoogleMap>
      <div className="absolute bottom-2 right-2 bg-white/95 backdrop-blur px-2 py-1 rounded-md text-[10px] text-slate-600 font-bold border border-slate-200 shadow-sm">
        {routeLoading ? "Updating route…" : isOnRoute || !decodedPath?.length ? "Tracking View" : "Off route — rerouting…"}
      </div>
      {routeData?.degraded && (
        <div className="absolute top-2 left-2 bg-amber-50/95 text-amber-900 text-[10px] px-2 py-1 rounded border border-amber-200 max-w-[85%] leading-snug">
          Route unavailable. Add{" "}
          <span className="font-mono">GOOGLE_MAPS_API_KEY</span> to the{" "}
          <strong>backend</strong> <span className="font-mono">.env</span>, enable
          Directions API + billing, then restart the API server.
        </div>
      )}
    </div>
  );
}


// Memoized export to prevent unnecessary re-renders and reduce Google Maps API costs
const DeliveryTrackingMap = memo(DeliveryTrackingMapComponent, (prevProps, nextProps) => {
  // Only re-render if these props actually change
  const destPrev = destinationForPhase(prevProps.order, prevProps.phase);
  const destNext = destinationForPhase(nextProps.order, nextProps.phase);
  
  return (
    prevProps.orderId === nextProps.orderId &&
    prevProps.phase === nextProps.phase &&
    destPrev?.lat === destNext?.lat &&
    destPrev?.lng === destNext?.lng
  );
});

DeliveryTrackingMap.displayName = 'DeliveryTrackingMap';

export default DeliveryTrackingMap;
