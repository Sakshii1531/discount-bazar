/**
 * Razorpay SDK Script Loader
 * Dynamically loads https://checkout.razorpay.com/v1/checkout.js on-demand.
 * Returns a promise that resolves to boolean (true if loaded, false if failed).
 */

let loadPromise = null;

export const loadRazorpayScript = () => {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }

  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve) => {
    const existingScript = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );

    if (existingScript) {
      if (window.Razorpay) {
        resolve(true);
      } else {
        existingScript.addEventListener("load", () => resolve(true));
        existingScript.addEventListener("error", () => resolve(false));
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => {
      resolve(true);
    };
    script.onerror = () => {
      loadPromise = null;
      resolve(false);
    };

    document.body.appendChild(script);
  });

  return loadPromise;
};

export default loadRazorpayScript;
