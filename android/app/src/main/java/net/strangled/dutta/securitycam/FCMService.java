package net.strangled.dutta.securitycam;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import net.strangled.dutta.securitycam.API.HTTP;
import net.strangled.dutta.securitycam.plugins.MotionService.MotionForegroundService;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public class FCMService extends FirebaseMessagingService {
    private static final String EVENT_CHANNEL_ID = "motion_event_channel";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        if (MotionForegroundService.getMuteUntilTimestamp() > System.currentTimeMillis()) {
            Log.d("FCMService", "Notification suppressed: Mute active for another " +
                    ((MotionForegroundService.getMuteUntilTimestamp() - System.currentTimeMillis()) / 60000L) + " minutes.");
            return;
        }

        if (MotionForegroundService.getIsSocketConnected()) {
            Log.d("FCMService", "Socket is connected, notification may be duplicated");
        }

        Map<String, String> data = remoteMessage.getData();
        StringBuilder allKeys = new StringBuilder();
        Set<String> keys = Objects.requireNonNull(remoteMessage.getData()).keySet();
        for (String key : keys) {
            allKeys.append(key).append(" ");
        }
        Log.i("FCMService", "Notification received, intent extras: " + allKeys);
        if (!data.isEmpty()) {
            try {
                String vibrateTimingsMillis = data.get("vibrateTimingsMillis");
                if (vibrateTimingsMillis == null) vibrateTimingsMillis = "0,500,500,0";
                showNotificationWithActions(
                        data.get("channelId"), data.get("title"), data.get("body"), data.get("icon"),
                        data.get("color"), data.get("sound"), vibrateTimingsMillis, data.get("streamUrl"),
                        data.get("cameraId"), data.get("group"), data.get("actions")
                );
            } catch (IOException e) {
                Log.e("FCMService", "Error showing notification", e);
            }
        }
    }

    private void showNotificationWithActions(String channelId, String title, String body, String icon,
                                             String color,  String sound, String vibrateTimingsMillis,
                                             String streamUrl, String cameraId, String group, String actions)
            throws IOException {
        int notificationId = (int) System.currentTimeMillis();
        // 1. Intent for the "Open" button (launches your app)
        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        assert intent != null;
        intent.putExtra(getPackageName() + ".streamUrl", streamUrl);
        intent.putExtra(getPackageName() + ".cameraId", cameraId);
        intent.putExtra(getPackageName() + ".notificationId", notificationId);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Bundle extras = new Bundle();
        extras.putString("streamUrl", streamUrl);

        String[] stringArray = vibrateTimingsMillis.split(",");
        long[] vibrateTimingsMillisArray = new long[stringArray.length];

        for (int i = 0; i < stringArray.length; i++) {
            try {
                vibrateTimingsMillisArray[i] = Long.parseLong(stringArray[i]);
            } catch (NumberFormatException e) {
                Log.e("FCMService", "Error parsing vibrateTimingsMillis: " + e.getMessage());
                vibrateTimingsMillisArray[i] = 0L;
            }
        }

        String channelIdFinal = Objects.requireNonNullElse(channelId, EVENT_CHANNEL_ID);

        Log.d("FCMService", "Showing notification");
        Log.d("FCMService", "Title: " + title);
        Log.d("FCMService", "Body: " + body);
        Log.d("FCMService", "Icon: " + icon);
        Log.d("FCMService", "Color: " + color);
        Log.d("FCMService", "Sound: " + sound);
        Log.d("FCMService", "Vibrate: " + Arrays.toString(vibrateTimingsMillisArray));

        // 2. Build the notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelIdFinal)
                // .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(getApplicationInfo().icon)
                .setColor(Color.parseColor(color))
                .setGroup("detection_info")
                .setLights(Color.parseColor(color), 500, 500)
                .setVibrate(vibrateTimingsMillisArray)
                .addExtras(extras)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        if (title.equals("Motion Detected!")) {
            builder.setCategory(NotificationCompat.CATEGORY_ALARM);
            builder.setGroup("motion_event");
            builder.setSound(Uri.parse("android.resource://" + getPackageName() + "/raw/motion_alert"));
            // res/drawable/push_icon.png
            builder.setSmallIcon(R.drawable.push_icon);
        }

        if (group != null) builder.setGroup(group);
        if (actions.equals("true")) {
            Log.d("FCMService", "Actions enabled");
            InputStream is = getAssets().open("capacitor.config.json");
            InputStreamReader reader = new InputStreamReader(is);
            JsonObject config = JsonParser.parseReader(reader).getAsJsonObject();

            if (config.has("server")) {
                String baseUrl = config.getAsJsonObject("server").get("url").getAsString();
                SharedPreferences sharedPref = getSharedPreferences("CapacitorStorage", Activity.MODE_PRIVATE);
                String clientId = sharedPref.getString("clientId", null);

                assert baseUrl != null;
                assert clientId != null;
                intent.putExtra(getPackageName() + ".baseUrl", baseUrl);
                intent.putExtra(getPackageName() + ".clientId", clientId);

                Intent pauseIntent = new Intent(this, PauseDetectionNotificationActionReceiver.class);
                pauseIntent.putExtra(getPackageName() + ".cameraId", cameraId);
                pauseIntent.putExtra(getPackageName() + ".baseUrl", baseUrl);
                pauseIntent.putExtra(getPackageName() + ".notificationId", notificationId);
                pauseIntent.putExtra(getPackageName() + ".clientId", clientId);
                pauseIntent.putExtra(getPackageName() + ".pause", true);

                // Use getBroadcast because we are targeting a BroadcastReceiver
                PendingIntent pausePendingIntent = PendingIntent.getBroadcast(
                        this,
                        notificationId, // Unique request code
                        pauseIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

                builder.addAction(android.R.drawable.ic_media_pause, "Pause Detection", pausePendingIntent);
            }
        }

        Notification notif = builder.build();
        Log.d("FCMService", "Notification built");

        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        // Use a unique ID (like current time) so notifications don't overwrite each other
        try {
            Log.d("FCMService", "Showing notification");
            MotionForegroundService.createNotificationChannels(getApplicationContext());
            notificationManager.notify(notificationId, notif);
            Log.d("FCMService", "Notification shown");
        } catch (SecurityException e) {
            Log.e("FCMService", "Error showing notification", e);
        }
    }

    /**
     * There are two scenarios when onNewToken is called:
     * 1) When a new token is generated on initial app startup
     * 2) Whenever an existing token is changed
     * Under #2, there are three scenarios when the existing token is changed:
     * A) App is restored to a new device
     * B) User uninstalls/reinstalls the app
     * C) User clears app data
     */
    @Override
    public void onNewToken(@NonNull String fcmToken) {
        SharedPreferences sharedPref = getSharedPreferences("CapacitorStorage", Activity.MODE_PRIVATE);
        String refreshToken = sharedPref.getString("refreshToken", null);

        // If you want to send messages to this application instance or
        // manage this apps subscriptions on the server side, send the
        // FCM registration token to your app server.
        if (refreshToken != null) {
            try {
                sendRegistrationToServer(sharedPref, fcmToken);
            } catch (IOException e) {
                Log.e("FCMService", "Error sending token to server", e);
            }
        }
    }

    private void sendRegistrationToServer(@NonNull SharedPreferences sharedPref,
                                          @NonNull String fcmToken) throws IOException {
        InputStream is = getAssets().open("capacitor.config.json");
        InputStreamReader reader = new InputStreamReader(is);
        JsonObject config = JsonParser.parseReader(reader).getAsJsonObject();

        if (config.has("server")) {
            String baseUrl = config.getAsJsonObject("server").get("url").getAsString();
            String clientId = sharedPref.getString("clientId", null);

            assert baseUrl != null;
            assert clientId != null;

//            interface DeviceInfo {
//                userAgent: string
//                platform: string
//                vendor: string
//                language: string
//                timezone: string
//                screen: string
//                clientId: string
//            }
            JsonObject dummyDeviceInfoInner = new JsonObject();
            dummyDeviceInfoInner.addProperty("clientId", clientId);
            dummyDeviceInfoInner.addProperty("userAgent", MainActivity.userAgent);

            JsonObject dummyDeviceInfo = new JsonObject();
            dummyDeviceInfo.add("deviceInfo", dummyDeviceInfoInner);

            JsonObject fcmSubscribeBody = new JsonObject();
            fcmSubscribeBody.addProperty("fcmToken", fcmToken);

            HTTP.subscribeToFCM(baseUrl, clientId, fcmToken, null);
        } else {
            Log.e("FCMService", "No server URL found in capacitor.config.json");
        }
    }
}
