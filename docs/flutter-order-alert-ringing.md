# Order-alert ringing on a locked phone (Flutter wrapper)

The Seller and Delivery apps are the web app running inside the Flutter
WebView wrapper (`window.Flutter` / `TurboCartBridge`). When the phone is locked
or the app is in the background, the WebView's JavaScript is paused, so the
in-page ringtone (`DashboardLayout.jsx` / `DeliveryLayout.jsx`) **cannot** play.
The ring on a locked phone has to come from the native Android/iOS notification.

The backend already sends every order alert (`NEW_ORDER`, `RETURN_REQUESTED`,
`RETURN_DROP_OTP`, `NEW_DELIVERY_BROADCAST`, `NEW_RETURN_BROADCAST`,
`DELIVERY_ASSIGNED`) as a high-priority FCM message with:

| Field | Value |
|---|---|
| `android.notification.channelId` | `order_alert` |
| `android.notification.sound` | `order_alert` (= `res/raw/order_alert.*`) |
| `android.notification.tag` | the `orderId` |
| `data.sound` | `order_alert` (use this to recognise an alert) |
| `data.orderId` | order id |
| `apns.payload.aps.sound` | `order_alert.caf` |
| `apns.payload.aps.interruption-level` | `time-sensitive` |

It also sends a data-only `data.type == "ORDER_ALERT_DISMISS"` message (with
`data.orderId`) when the order is accepted, rejected or taken on another device.
The web app sends `dismiss_order_alert:<orderId>` over the JS bridge when the
order is handled on this device.

The wrapper must do the following. Without steps 1–2, Android puts the push on
the fallback "Miscellaneous" channel, and it plays one default ding or stays silent.

## 1. Bundle the sound

- Android: copy `frontend/public/sounds/order_alert.mp3` to
  `android/app/src/main/res/raw/order_alert.mp3`. The name must be lowercase with
  no hyphens. Add `android/app/src/main/res/raw/keep.xml` so R8 does not strip it:
  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <resources xmlns:tools="http://schemas.android.com/tools"
      tools:keep="@raw/order_alert" />
  ```
- iOS: convert it and add `order_alert.caf` to the Runner target (Copy Bundle Resources).
  The sound must be 30 seconds or shorter:
  `afconvert order_alert.mp3 order_alert.caf -d ima4 -f caff`

## 2. Create the `order_alert` channel at startup (before any push arrives)

Android channel settings are **immutable**. If an `order_alert` channel was ever
created without this sound, the change will not apply until the app is
uninstalled and reinstalled. Already-installed phones must reinstall.

```dart
// pubspec: flutter_local_notifications, firebase_messaging
final FlutterLocalNotificationsPlugin fln = FlutterLocalNotificationsPlugin();

const AndroidNotificationChannel orderAlertChannel = AndroidNotificationChannel(
  'order_alert', 'Order alerts',
  description: 'Rings for new orders and delivery requests',
  importance: Importance.max,
  playSound: true,
  sound: RawResourceAndroidNotificationSound('order_alert'),
  enableVibration: true,
  audioAttributesUsage: AudioAttributesUsage.alarm, // rings even if notification volume is low
);

Future<void> initOrderAlerts() async {
  await fln.initialize(const InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    iOS: DarwinInitializationSettings(),
  ));
  await fln
      .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.createNotificationChannel(orderAlertChannel);
  await fln
      .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.requestNotificationsPermission(); // Android 13+
  await FirebaseMessaging.instance.requestPermission(alert: true, sound: true, badge: true);
}
```

Call `initOrderAlerts()` in `main()` after `Firebase.initializeApp()`.

## 3. Keep it ringing until handled (background handler)

A normal notification sound plays once. To ring continuously, re-post the alert
with the **insistent** flag (`FLAG_INSISTENT = 4`). Use the same tag (`orderId`)
and id `0` so it replaces the copy FCM already showed.

```dart
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  final data = message.data;
  final orderId = data['orderId'] ?? '';

  if (data['type'] == 'ORDER_ALERT_DISMISS') {
    if (orderId.isNotEmpty) await fln.cancel(0, tag: orderId);
    return;
  }
  if (data['sound'] != 'order_alert') return;

  await fln.show(
    0,
    message.notification?.title ?? data['title'] ?? 'New order',
    message.notification?.body ?? data['body'] ?? '',
    NotificationDetails(
      android: AndroidNotificationDetails(
        orderAlertChannel.id, orderAlertChannel.name,
        tag: orderId.isEmpty ? null : orderId,
        importance: Importance.max,
        priority: Priority.max,
        category: AndroidNotificationCategory.call,
        fullScreenIntent: true,          // lights up the lock screen
        visibility: NotificationVisibility.public,
        ongoing: true,
        autoCancel: true,
        timeoutAfter: 60000,              // stop ringing after 60 s
        additionalFlags: Int32List.fromList(<int>[4]), // FLAG_INSISTENT: loop the sound
      ),
      iOS: const DarwinNotificationDetails(
        presentSound: true,
        sound: 'order_alert.caf',
        interruptionLevel: InterruptionLevel.timeSensitive,
      ),
    ),
    payload: data['link'],
  );
}

// in main():
FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
```

## 4. Stop ringing when the web app handles the order

In the WebView `JavaScriptChannel` (`Flutter`) handler:

```dart
if (msg.startsWith('dismiss_order_alert:')) {
  final orderId = msg.substring('dismiss_order_alert:'.length);
  await fln.cancel(0, tag: orderId);
}
```

Also call `fln.cancelAll()` (or cancel by tag) when the app comes to the
foreground, because the web page takes over with its in-app ringtone.

## 5. AndroidManifest.xml

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>
<uses-permission android:name="android.permission.VIBRATE"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>

<application ...>
  <meta-data
      android:name="com.google.firebase.messaging.default_notification_channel_id"
      android:value="order_alert"/>
  <activity ... android:showWhenLocked="true" android:turnScreenOn="true">
```

## 6. Battery optimisation (Xiaomi / Oppo / Vivo / Realme / OnePlus)

These phones block background FCM for apps that aren't exempt. Ask once after
login: open `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (for example with the
`permission_handler` package and `Permission.ignoreBatteryOptimizations.request()`).
On MIUI, also guide the user to enable **Autostart** for the app.

## Testing checklist

1. Uninstall the old app and install the new build (the channel is recreated with the sound).
2. Log in as seller or rider and grant notification permission plus the battery exemption.
3. Lock the phone. Place an order from another device.
4. Expected: the screen lights up and the ringtone loops until you tap the alert, the
   order is accepted elsewhere, or 60 seconds pass.
