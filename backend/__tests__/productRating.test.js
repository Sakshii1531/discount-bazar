import {
  RATING_STATUSES,
  POSITIVE_FEEDBACK_TAGS,
  NEGATIVE_FEEDBACK_TAGS,
  ALL_PRODUCT_FEEDBACK_TAGS,
  RATING_WINDOW_DAYS,
} from "../app/constants/productRatingConstants.js";

describe("Product Rating & Review System Unit Tests", () => {
  test("should have correct rating status constants", () => {
    expect(RATING_STATUSES.ACTIVE).toBe("ACTIVE");
    expect(RATING_STATUSES.FLAGGED).toBe("FLAGGED");
    expect(RATING_STATUSES.HIDDEN).toBe("HIDDEN");
    expect(RATING_STATUSES.REMOVED).toBe("REMOVED");
  });

  test("should validate controlled positive and negative feedback tags", () => {
    expect(POSITIVE_FEEDBACK_TAGS).toContain("GOOD_QUALITY");
    expect(POSITIVE_FEEDBACK_TAGS).toContain("FRESH");
    expect(POSITIVE_FEEDBACK_TAGS).toContain("GOOD_TASTE");
    expect(NEGATIVE_FEEDBACK_TAGS).toContain("POOR_QUALITY");
    expect(NEGATIVE_FEEDBACK_TAGS).toContain("NOT_FRESH");
    expect(NEGATIVE_FEEDBACK_TAGS).toContain("DAMAGED");

    expect(ALL_PRODUCT_FEEDBACK_TAGS).toEqual([
      ...POSITIVE_FEEDBACK_TAGS,
      ...NEGATIVE_FEEDBACK_TAGS,
    ]);
  });

  test("should enforce a 7-day rating window", () => {
    expect(RATING_WINDOW_DAYS).toBe(7);
  });

  test("should correctly validate rating integer range 1 to 5", () => {
    const isValidRating = (r) => Number.isInteger(r) && r >= 1 && r <= 5;

    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(5)).toBe(true);
    expect(isValidRating(3)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
    expect(isValidRating(-1)).toBe(false);
    expect(isValidRating(NaN)).toBe(false);
    expect(isValidRating(null)).toBe(false);
  });

  test("should calculate correct product rating aggregate average and distribution", () => {
    const ratings = [5, 5, 4, 3, 1];
    const sum = ratings.reduce((a, b) => a + b, 0);
    const count = ratings.length;
    const avg = Number((sum / count).toFixed(2));

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach((r) => {
      distribution[r] += 1;
    });

    expect(sum).toBe(18);
    expect(count).toBe(5);
    expect(avg).toBe(3.6);
    expect(distribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 2 });
  });

  test("should correctly adjust aggregates on ACTIVE to HIDDEN transition", () => {
    let sum = 18;
    let count = 5;

    // Moderate one 5-star rating from ACTIVE to HIDDEN
    const moderatedRating = 5;
    sum -= moderatedRating;
    count -= 1;
    const newAvg = Number((sum / count).toFixed(2));

    expect(sum).toBe(13);
    expect(count).toBe(4);
    expect(newAvg).toBe(3.25);
  });
});
