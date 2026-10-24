import { dateRangeFilter } from "../../../app/services/businessTime.js";

describe("dateRangeFilter", () => {
  test("returns null when no bound is given", () => {
    expect(dateRangeFilter({})).toBeNull();
    expect(dateRangeFilter({ from: "", to: "  " })).toBeNull();
  });

  test("YYYY-MM-DD keys cover whole days in the seller's timezone", () => {
    expect(dateRangeFilter({ from: "2026-10-01", to: "2026-10-24" }, "Asia/Kolkata")).toEqual({
      $gte: new Date("2026-09-30T18:30:00.000Z"),
      $lte: new Date("2026-10-24T18:29:59.999Z"),
    });
  });

  test("accepts startDate/endDate aliases and open-ended ranges", () => {
    expect(dateRangeFilter({ startDate: "2026-10-01" }, "UTC")).toEqual({ $gte: new Date("2026-10-01T00:00:00.000Z") });
    expect(dateRangeFilter({ endDate: "2026-10-01" }, "UTC")).toEqual({ $lte: new Date("2026-10-01T23:59:59.999Z") });
  });

  test("swaps a reversed range instead of matching nothing", () => {
    expect(dateRangeFilter({ from: "2026-10-24", to: "2026-10-01" }, "UTC")).toEqual({
      $gte: new Date("2026-10-01T00:00:00.000Z"),
      $lte: new Date("2026-10-24T23:59:59.999Z"),
    });
  });

  test("ignores unparseable values and keeps exact ISO instants", () => {
    expect(dateRangeFilter({ from: "not-a-date" })).toBeNull();
    expect(dateRangeFilter({ from: "2026-10-01T10:00:00.000Z" })).toEqual({ $gte: new Date("2026-10-01T10:00:00.000Z") });
  });
});
