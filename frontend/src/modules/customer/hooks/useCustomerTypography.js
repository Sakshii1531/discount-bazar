import { useLayoutEffect } from "react";

const CLASS_NAME = "customer-app";

/**
 * Switches on the larger customer type scale (see `html.customer-app` in
 * index.css) while the calling component is mounted.
 *
 * The class lives on <html> rather than a wrapper div so content portalled
 * to <body> (product sheet, dialogs, toasts) picks it up as well. It is
 * removed on unmount so seller/admin/delivery panels keep their own scale.
 */
export function useCustomerTypography() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add(CLASS_NAME);
    return () => root.classList.remove(CLASS_NAME);
  }, []);
}
