import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;
if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder;

globalThis.__VITE_ENV__ = {
  MODE: 'test',
  DEV: false,
  PROD: false,
  SSR: false,
  VITE_API_URL: 'http://localhost:7000/api',
};

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

if (!window.scrollTo || window.scrollTo.toString().includes('not implemented')) {
  window.scrollTo = () => {};
}

afterEach(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});
