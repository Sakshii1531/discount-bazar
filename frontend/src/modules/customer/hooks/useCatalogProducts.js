import { useCallback, useEffect, useRef, useState } from "react";
import { customerApi } from "../services/customerApi";
import { useLocation as useAppLocation } from "../context/LocationContext";
import { toCardProduct } from "../utils/productPricing";

export const CATALOG_PAGE_SIZE = 24;

// GET /products answers 200 with these messages when no seller serves the
// customer's location.
const AREA_UNAVAILABLE_MESSAGES = ["No sellers found in your area", "No products available in your area"];

/**
 * Paged customer product listing (GET /products) for the given filters and
 * the customer's current location. Changing filters or location starts over
 * at page 1; responses for an older request are ignored.
 *
 * status: "loading" | "ready" | "error" | "no-location"
 */
export function useCatalogProducts(filters, { enabled = true } = {}) {
  const { currentLocation } = useAppLocation();
  const lat = currentLocation?.latitude;
  const lng = currentLocation?.longitude;
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const filtersKey = JSON.stringify(filters || {});

  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [areaUnavailable, setAreaUnavailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const requestRef = useRef(0);

  const fetchPage = useCallback(
    async (pageToLoad, { append = false, forceRefresh = false } = {}) => {
      const requestId = ++requestRef.current;
      setLoadingMore(append);
      if (!append) setStatus("loading");

      try {
        const params = { ...JSON.parse(filtersKey), lat, lng, page: pageToLoad, limit: CATALOG_PAGE_SIZE };
        Object.keys(params).forEach((k) => (params[k] === undefined || params[k] === "") && delete params[k]);
        const res = await (forceRefresh
          ? customerApi.getProductsFresh(params)
          : customerApi.getProducts(params));
        if (requestId !== requestRef.current) return;

        const body = res?.data || {};
        if (!body.success) throw new Error(body.message || "Failed to load products");
        const result = body.result || {};
        const list = (Array.isArray(result.items) ? result.items : []).map(toCardProduct);

        setAreaUnavailable(!append && list.length === 0 && AREA_UNAVAILABLE_MESSAGES.includes(body.message));
        // A product can shift pages while browsing; never show it twice.
        setItems((prev) => {
          if (!append) return list;
          const seen = new Set(prev.map((p) => String(p.id)));
          return [...prev, ...list.filter((p) => !seen.has(String(p.id)))];
        });
        setPage(Number(result.page) || pageToLoad);
        setTotalPages(Number(result.totalPages) || 1);
        setTotal(Number(result.total) || 0);
        setErrorMessage("");
        setStatus("ready");
      } catch (error) {
        if (requestId !== requestRef.current) return;
        const message = error?.response?.data?.message || "We couldn't load products. Please try again.";
        if (append) {
          setErrorMessage(message);
        } else {
          setItems([]);
          setErrorMessage(message);
          setStatus("error");
        }
      } finally {
        if (requestId === requestRef.current) setLoadingMore(false);
      }
    },
    [filtersKey, lat, lng],
  );

  useEffect(() => {
    if (!enabled) return;
    if (!hasLocation) {
      requestRef.current += 1;
      setItems([]);
      setStatus("no-location");
      return;
    }
    fetchPage(1);
  }, [enabled, hasLocation, fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || status !== "ready" || page >= totalPages) return;
    fetchPage(page + 1, { append: true });
  }, [fetchPage, loadingMore, page, status, totalPages]);

  const retry = useCallback(() => fetchPage(1, { forceRefresh: true }), [fetchPage]);

  return {
    items,
    total,
    status,
    areaUnavailable,
    errorMessage,
    hasMore: status === "ready" && page < totalPages,
    loadingMore,
    loadMore,
    retry,
  };
}
