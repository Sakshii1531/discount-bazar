import { jest } from "@jest/globals";

const mockSendEachForMulticast = jest.fn();

jest.unstable_mockModule("firebase-admin", () => ({
  default: {
    messaging: () => ({ sendEachForMulticast: mockSendEachForMulticast }),
  },
}));

jest.unstable_mockModule("../app/config/firebaseAdmin.js", () => ({
  getFirebaseAdminApp: () => ({}),
}));

const { sendFCM, sendFCMDismiss } = await import(
  "../app/modules/notifications/firebase.service.js"
);

function lastMessage() {
  const calls = mockSendEachForMulticast.mock.calls;
  return calls[calls.length - 1][0];
}

describe("FCM order alert payloads", () => {
  beforeEach(() => {
    mockSendEachForMulticast.mockReset();
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });
  });

  test("new seller order rings on the order_alert channel, tagged by order", async () => {
    await sendFCM(["t1"], {
      title: "New Order 🔔",
      body: "Order #A1",
      data: { eventType: "NEW_ORDER", role: "seller", orderId: "A1" },
    });
    const msg = lastMessage();
    expect(msg.android.notification.channelId).toBe("order_alert");
    expect(msg.android.notification.sound).toBe("order_alert");
    expect(msg.android.notification.tag).toBe("A1");
    expect(msg.apns.headers["apns-collapse-id"]).toBe("A1");
  });

  test("seller cancellation notice replaces the alert but never rings the order tone", async () => {
    await sendFCM(["t1"], {
      title: "Order Cancelled",
      body: "Order #A1 was cancelled.",
      data: { eventType: "ORDER_CANCELLED", role: "seller", orderId: "A1" },
    });
    const msg = lastMessage();
    expect(msg.android.notification.channelId).toBe("default");
    expect(msg.android.notification.sound).toBe("default");
    expect(msg.android.notification.tag).toBe("A1");
    expect(msg.data.sound).toBeUndefined();
  });

  test("rider delivery broadcast is treated as an order alert", async () => {
    await sendFCM(["t1"], {
      title: "New Delivery Request 🛍️",
      body: "New order #A1 is available nearby.",
      data: { eventType: "NEW_DELIVERY_BROADCAST", role: "delivery", orderId: "A1" },
    });
    expect(lastMessage().android.notification.channelId).toBe("order_alert");
  });

  test("dismissal is data-only so it cannot show or ring a notification", async () => {
    await sendFCMDismiss(["t1", "t2"], { orderId: "A1", reason: "cancelled" });
    const msg = lastMessage();
    expect(msg.notification).toBeUndefined();
    expect(msg.android.notification).toBeUndefined();
    expect(msg.tokens).toEqual(["t1", "t2"]);
    expect(msg.data).toMatchObject({
      type: "ORDER_ALERT_DISMISS",
      orderId: "A1",
      reason: "cancelled",
    });
  });
});
