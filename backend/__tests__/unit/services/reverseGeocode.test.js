import { jest } from "@jest/globals";

// Pure unit test: no Redis, no Mongo, no network.
const reverseGeocodeMock = jest.fn();
jest.unstable_mockModule("@googlemaps/google-maps-services-js", () => ({
  Client: jest.fn(() => ({ reverseGeocode: reverseGeocodeMock, geocode: jest.fn() })),
}));
jest.unstable_mockModule("../../../app/config/redis.js", () => ({
  getRedisClient: () => null,
}));
jest.unstable_mockModule("../../../app/models/geocodeCache.js", () => ({
  default: { findOne: jest.fn(), updateOne: jest.fn() },
}));

const { reverseGeocode } = await import("../../../app/services/mapsGeocodeService.js");

// Srinagar, Jammu & Kashmir.
const comp = (long_name, types) => ({ long_name, types });
const googleSrinagar = {
  status: "OK",
  results: [
    { types: ["plus_code"], formatted_address: "XQ2P+5X Srinagar", address_components: [] },
    {
      types: ["street_address"],
      place_id: "pid-1",
      formatted_address: "Lal Chowk, Srinagar, Jammu and Kashmir 190001, India",
      address_components: [
        comp("Lal Chowk", ["sublocality_level_1", "sublocality", "political"]),
        comp("Srinagar", ["locality", "political"]),
        comp("Jammu and Kashmir", ["administrative_area_level_1", "political"]),
        comp("190001", ["postal_code"]),
        comp("India", ["country", "political"]),
      ],
    },
  ],
};

let lat = 34.07;
const nextCoords = () => {
  // Fresh coordinates per test so the in-memory cache never leaks between tests.
  lat += 0.01;
  return [lat, 74.8];
};

const realFetch = global.fetch;
const realKey = process.env.GOOGLE_MAPS_API_KEY;

afterEach(() => {
  reverseGeocodeMock.mockReset();
  global.fetch = realFetch;
  process.env.GOOGLE_MAPS_API_KEY = realKey;
});

describe("reverseGeocode", () => {
  it("resolves city/state from Google, skipping plus-code results", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    reverseGeocodeMock.mockResolvedValue({ data: googleSrinagar });

    const r = await reverseGeocode(...nextCoords());

    expect(r).toMatchObject({
      city: "Srinagar",
      state: "Jammu and Kashmir",
      pincode: "190001",
      country: "India",
      placeId: "pid-1",
      source: "google",
    });
    expect(r.displayName).toBe("Lal Chowk, Srinagar, Jammu and Kashmir 190001, India");
  });

  it("falls back to Nominatim when Google rejects the request", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    reverseGeocodeMock.mockResolvedValue({ data: { status: "REQUEST_DENIED" } });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        display_name: "Gandhi Nagar, Jammu, Jammu and Kashmir, 180004, India",
        address: {
          suburb: "Gandhi Nagar",
          city: "Jammu",
          state: "Jammu and Kashmir",
          postcode: "180004",
          country: "India",
        },
      }),
    }));

    const r = await reverseGeocode(...nextCoords());

    expect(r).toMatchObject({ city: "Jammu", state: "Jammu and Kashmir", pincode: "180004", source: "osm" });
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers["User-Agent"]).toBeTruthy();
  });

  it("uses Nominatim directly when no Google key is configured", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "";
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ address: { town: "Anantnag", state: "Jammu and Kashmir" } }),
    }));

    const r = await reverseGeocode(...nextCoords());

    expect(reverseGeocodeMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ city: "Anantnag", state: "Jammu and Kashmir" });
  });

  it("throws instead of inventing an address when every source fails", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    reverseGeocodeMock.mockRejectedValue(new Error("network"));
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));

    await expect(reverseGeocode(...nextCoords())).rejects.toMatchObject({ statusCode: 502 });
  });

  it("rejects invalid coordinates", async () => {
    await expect(reverseGeocode("abc", 74)).rejects.toMatchObject({ statusCode: 400 });
    await expect(reverseGeocode(91, 74)).rejects.toMatchObject({ statusCode: 400 });
  });
});
