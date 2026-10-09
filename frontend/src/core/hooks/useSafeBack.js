import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Back button that never leaves the app: goes to the previous in-app page,
 * or to `fallback` when this page was opened directly (shared link, new tab).
 * React Router marks the first entry of a session with key "default".
 */
export default function useSafeBack(fallback = "/") {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key && location.key !== "default") navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, location.key, fallback]);
}
