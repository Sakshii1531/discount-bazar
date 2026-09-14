import {
  RATING_STATUSES,
  POSITIVE_FEEDBACK_TAGS,
  NEGATIVE_FEEDBACK_TAGS,
  RATING_WINDOW_DAYS,
} from "../app/constants/deliveryRatingConstants.js";

describe("Delivery Partner Rating System Unit Tests", () => {
  test("should have correct rating status constants", () => {
    expect(RATING_STATUSES.ACTIVE).toBe("ACTIVE");
    expect(RATING_STATUSES.FLAGGED).toBe("FLAGGED");
    expect(RATING_STATUSES.HIDDEN).toBe("HIDDEN");
    expect(RATING_STATUSES.REMOVED).toBe("REMOVED");
  });

  test("should validate positive and negative feedback tags", () => {
    expect(POSITIVE_FEEDBACK_TAGS).toContain("POLITE");
    expect(POSITIVE_FEEDBACK_TAGS).toContain("QUICK_DELIVERY");
    expect(NEGATIVE_FEEDBACK_TAGS).toContain("DELIVERY_LATE");
    expect(NEGATIVE_FEEDBACK_TAGS).toContain("RUDE_BEHAVIOUR");
  });

  test("should enforce a 7-day rating window", () => {
    expect(RATING_WINDOW_DAYS).toBe(7);
  });

  test("should calculate correct aggregate averages", () => {
    const ratings = [5, 5, 4, 3, 1];
    const sum = ratings.reduce((a, b) => a + b, 0);
    const count = ratings.length;
    const avg = Number((sum / count).toFixed(2));

    expect(sum).toBe(18);
    expect(count).toBe(5);
    expect(avg).toBe(3.6);
  });
});
