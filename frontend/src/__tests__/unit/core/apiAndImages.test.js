import { resolveApiBaseUrl, resolveSocketBaseUrl } from '@core/api/resolveApiBaseUrl';
import { applyCloudinaryTransform, isCloudinaryUrl, buildCloudinarySrcSet } from '@core/utils/imageUtils';
import { getCachedGeocode, setCachedGeocode } from '@core/utils/geocodeCache';
import { isMobileOrWebView } from '@core/utils/deviceUtils';

const BASE_ENV = { MODE: 'test' };

function setEnv(env) {
  globalThis.__VITE_ENV__ = { ...BASE_ENV, ...env };
}

describe('core/api/resolveApiBaseUrl (env configured)', () => {
  const originalEnv = globalThis.__VITE_ENV__;
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.__VITE_ENV__ = originalEnv;
    logSpy.mockRestore();
  });

  it('uses VITE_API_URL and appends /api when missing', () => {
    setEnv({ VITE_API_URL: 'https://api.example.com' });
    expect(resolveApiBaseUrl()).toBe('https://api.example.com/api');
    setEnv({ VITE_API_URL: 'https://api.example.com/v1/' });
    expect(resolveApiBaseUrl()).toBe('https://api.example.com/v1/api');
    setEnv({ VITE_API_URL: 'https://api.example.com/api' });
    expect(resolveApiBaseUrl()).toBe('https://api.example.com/api');
  });

  it('falls back to VITE_API_BASE_URL', () => {
    setEnv({ VITE_API_BASE_URL: 'https://b.example.com/api' });
    expect(resolveApiBaseUrl()).toBe('https://b.example.com/api');
  });

  it('uses port 7000 on localhost when no env is set', () => {
    setEnv({});
    expect(resolveApiBaseUrl()).toBe('http://localhost:7000/api');
  });

  it('derives socket URL from API or VITE_SOCKET_URL', () => {
    setEnv({ VITE_API_URL: 'https://api.example.com/api' });
    expect(resolveSocketBaseUrl()).toBe('https://api.example.com');
    setEnv({ VITE_API_URL: 'https://api.example.com/api', VITE_SOCKET_URL: 'https://ws.example.com' });
    expect(resolveSocketBaseUrl()).toBe('https://ws.example.com');
  });
});

describe('core/utils/imageUtils', () => {
  const raw = 'https://res.cloudinary.com/demo/image/upload/v123/milk.jpg';

  it('inserts transforms into Cloudinary URLs', () => {
    expect(applyCloudinaryTransform(raw)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_400,dpr_auto/v123/milk.jpg',
    );
  });

  it('does not double-transform', () => {
    const transformed = applyCloudinaryTransform(raw);
    expect(applyCloudinaryTransform(transformed)).toBe(transformed);
  });

  it('leaves non-Cloudinary URLs alone', () => {
    expect(applyCloudinaryTransform('https://images.unsplash.com/x.jpg')).toBe('https://images.unsplash.com/x.jpg');
    expect(applyCloudinaryTransform('')).toBe('');
    expect(applyCloudinaryTransform(null)).toBeNull();
  });

  it('prefixes local /uploads paths with backend origin', () => {
    expect(applyCloudinaryTransform('/uploads/a.png')).toMatch(/^https?:\/\/[^/]+\/uploads\/a\.png$/);
  });

  it('detects Cloudinary URLs and builds srcset', () => {
    expect(isCloudinaryUrl(raw)).toBe(true);
    expect(isCloudinaryUrl('https://x.com/a.png')).toBe(false);
    const srcset = buildCloudinarySrcSet(raw, [{ w: 200 }, { w: 400, h: 400 }]);
    expect(srcset.split(', ')).toHaveLength(2);
    expect(srcset).toContain('w_200');
    expect(srcset).toContain('400w');
    expect(buildCloudinarySrcSet('https://x.com/a.png', [{ w: 1 }])).toBeUndefined();
  });
});

describe('core/utils/geocodeCache', () => {
  it('stores and reads by normalized key', () => {
    setCachedGeocode('  MG Road,   Indore ', { lat: 1, lng: 2 });
    expect(getCachedGeocode('mg road, indore')).toEqual({ lat: 1, lng: 2 });
  });

  it('ignores empty keys/values and expires entries', () => {
    setCachedGeocode('', { lat: 1 });
    setCachedGeocode('x', null);
    expect(getCachedGeocode('')).toBeNull();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    setCachedGeocode('short', { lat: 1 }, 60 * 1000);
    spy.mockReturnValue(now + 61 * 1000);
    expect(getCachedGeocode('short')).toBeNull();
    spy.mockRestore();
  });
});

describe('core/utils/deviceUtils', () => {
  it('detects narrow screens and Flutter webview', () => {
    const width = window.innerWidth;
    window.innerWidth = 1280;
    expect(isMobileOrWebView()).toBe(false);
    window.innerWidth = 500;
    expect(isMobileOrWebView()).toBe(true);
    window.innerWidth = 1280;
    window.Flutter = {};
    expect(isMobileOrWebView()).toBe(true);
    delete window.Flutter;
    window.innerWidth = width;
  });
});
