import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Ensures all pages and views in the Delivery module automatically
 * open from the very top on mount and route changes.
 */
const DeliveryScrollToTop = () => {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const resetScroll = () => {
      // 1. Reset standard browser window and body scroll
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      // 2. Reset layout scroll container (main) and any internal scrollable wrappers
      const scrollables = document.querySelectorAll(
        "main, .overflow-y-auto, .overflow-auto, [data-lenis-prevent]"
      );
      scrollables.forEach((el) => {
        el.scrollTop = 0;
      });
    };

    resetScroll();
    const raf = requestAnimationFrame(resetScroll);
    const timer = setTimeout(resetScroll, 50);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [pathname, search]);

  return null;
};

export default DeliveryScrollToTop;
