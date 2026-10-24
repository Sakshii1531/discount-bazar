import { jest } from "@jest/globals";

const mockOrderFind = jest.fn();
const mockOrderCountDocuments = jest.fn();
const mockDeliveryFindById = jest.fn();
const mockSellerFind = jest.fn();
const mockDistanceMeters = jest.fn();

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: {
    find: mockOrderFind,
    countDocuments: mockOrderCountDocuments,
  },
}));

jest.unstable_mockModule("../app/models/delivery.js", () => ({
  default: {
    findById: mockDeliveryFindById,
  },
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: {
    find: mockSellerFind,
  },
}));

jest.unstable_mockModule("../app/utils/geoUtils.js", () => ({
  distanceMeters: mockDistanceMeters,
}));

const {
  buildSellerOrdersQuery,
  fetchAvailableOrdersForDelivery,
} = await import("../app/services/orderQueryService.js");

function makeOrderQueryChain(result) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  };
}

function makeSelectChain(result) {
  return {
    select: jest.fn().mockResolvedValue(result),
  };
}

describe("orderQueryService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("buildSellerOrdersQuery maps sidebar status values and date range", () => {
    const query = buildSellerOrdersQuery({
      role: "seller",
      userId: "seller-1",
      statusParam: "processed",
      startDate: "2026-03-01",
      endDate: "2026-03-29",
    });

    expect(query.seller).toBe("seller-1");
    expect(query.status).toEqual({ $in: ["confirmed", "packed"] });
    // Whole days in the seller's timezone (Asia/Kolkata by default), not the server's.
    expect(query.createdAt.$gte).toEqual(new Date("2026-02-28T18:30:00.000Z"));
    expect(query.createdAt.$lte).toEqual(new Date("2026-03-29T18:29:59.999Z"));
  });

  test("buildSellerOrdersQuery honours an explicit timezone and swaps a reversed range", () => {
    const query = buildSellerOrdersQuery({
      role: "seller",
      userId: "seller-1",
      startDate: "2026-03-29",
      endDate: "2026-03-01",
      tz: "UTC",
    });

    expect(query.createdAt.$gte).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(query.createdAt.$lte).toEqual(new Date("2026-03-29T23:59:59.999Z"));
  });

  test("buildSellerOrdersQuery ignores unparseable dates instead of matching nothing", () => {
    const query = buildSellerOrdersQuery({ role: "seller", userId: "seller-1", startDate: "garbage" });
    expect(query.createdAt).toBeUndefined();
  });

  test("fetchAvailableOrdersForDelivery returns requiresLocation when rider has no coordinates", async () => {
    mockDeliveryFindById.mockResolvedValue({
      _id: "rider-1",
      location: null,
    });

    const result = await fetchAvailableOrdersForDelivery({
      userId: "rider-1",
      requestedLimit: "15",
    });

    expect(result.requiresLocation).toBe(true);
    expect(result.orders).toEqual([]);
    expect(mockOrderFind).not.toHaveBeenCalled();
  });

  test("fetchAvailableOrdersForDelivery filters V2 orders by effective search radius and merges with legacy", async () => {
    mockDeliveryFindById.mockResolvedValue({
      _id: "rider-1",
      location: {
        type: "Point",
        coordinates: [77.59, 12.97],
      },
    });

    mockSellerFind.mockReturnValueOnce(
      makeSelectChain([{ _id: "seller-1" }, { _id: "seller-2" }]),
    );

    mockOrderFind.mockImplementation((query) => {
      if (query.workflowStatus) {
        return makeOrderQueryChain([
          {
            orderId: "ORD-1",
            deliverySearchMeta: { radiusMeters: 5000 },
            seller: { location: { coordinates: [77.591, 12.971] }, serviceRadius: 5 },
          },
          {
            orderId: "ORD-2",
            deliverySearchMeta: { radiusMeters: 5000 },
            seller: { location: { coordinates: [77.8, 13.2] }, serviceRadius: 1 },
          },
        ]);
      }
      return makeOrderQueryChain([
        {
          orderId: "ORD-3",
          seller: { location: { coordinates: [77.592, 12.972] } },
        },
      ]);
    });

    mockDistanceMeters
      .mockReturnValueOnce(300)
      .mockReturnValueOnce(4000);

    const result = await fetchAvailableOrdersForDelivery({
      userId: "rider-1",
      requestedLimit: "10",
    });

    expect(result.requiresLocation).toBe(false);
    expect(result.orders.map((order) => order.orderId)).toEqual(["ORD-1", "ORD-3"]);
  });
});
