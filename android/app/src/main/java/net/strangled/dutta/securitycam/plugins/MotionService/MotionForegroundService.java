package net.strangled.dutta.securitycam.plugins.MotionService;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import net.strangled.dutta.securitycam.API.HTTP;
import net.strangled.dutta.securitycam.PauseDetectionNotificationActionReceiver;
import net.strangled.dutta.securitycam.R;

import org.json.JSONException;
import org.json.JSONObject;

import io.socket.client.IO;
import io.socket.client.Socket;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URISyntaxException;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class MotionForegroundService extends Service {
    private Socket mSocket;
    private PowerManager.WakeLock wakeLock;
    private boolean isConnecting = false;
    private final Handler reconnectHandler = new Handler(Looper.getMainLooper());
    private final Handler wakeLockHandler = new Handler(Looper.getMainLooper());
    private final Handler tokenUpdateHandler = new Handler(Looper.getMainLooper());
    private boolean isRefreshingToken = false;
    private static final String CHANNEL_ID = "motion_service_channel";
    private static final String EVENT_CHANNEL_ID = "motion_event_channel";
    private static final String LOW_EVENT_CHANNEL_ID = "motion_event_low_channel";

    private static boolean isSocketConnected = false;

    private static long muteUntilTimestamp = 0;

    public static long getMuteUntilTimestamp() {
        return muteUntilTimestamp;
    }

    @Override
    public void onCreate() {
        super.onCreate();

        // Start Foreground service
        MotionForegroundService.createNotificationChannels(getApplicationContext());
        startForeground(43253643, getStickyNotification());

        // Initialize Socket.io
        acquireWakeLock();
        startSocketWithDelay();
        updateTokenLoop();
    }

    @SuppressLint("LaunchActivityFromNotification")
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (intent != null) {
            if ("MUTE_NOTIFS_1H".equals(intent.getAction())) {
                muteUntilTimestamp = System.currentTimeMillis() + 60L*60L*1000L /* 1 hour */;
                manager.cancelAll();

                NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                        .setContentTitle("Tap below to re-enable notifications.")
                        .setSmallIcon(getApplicationInfo().icon)
                        .setColor(Color.parseColor("#2196F3"))
                        .setChannelId(CHANNEL_ID)
                        .setGroup("unmute_notifs")
                        .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                        .setPriority(NotificationCompat.PRIORITY_LOW)
                        .setLocalOnly(true)
                        .setOngoing(true);

                Intent unmuteIntent = new Intent(this, MotionForegroundService.class)
                        .setAction("UNMUTE_NOTIFS");
                PendingIntent unmutePendingIntent = PendingIntent.getService(
                        this, 5543244, unmuteIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                builder.addAction(android.R.drawable.ic_lock_silent_mode, "Unmute notifications", unmutePendingIntent);
                builder.setContentIntent(unmutePendingIntent);
                try {
                    manager.notify(5543245, builder.build());
                } catch (SecurityException e) {
                    Log.e("MotionForegroundService", "Error showing notification: " + e.getMessage());
                }

                Log.d("MotionForegroundService", "User muted alerts for 1 hour.");
            } else if ("UNMUTE_NOTIFS".equals(intent.getAction())) {
                manager.cancel(5543245);
                muteUntilTimestamp = 0L;
            }
        }

        return START_STICKY;
    }

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MotionForegroundService::acquireWakeLock");
        if (wakeLock != null) {
            wakeLock.acquire(10*60*1000L /* 10 minutes */);
        }
        wakeLockHandler.postDelayed(this::acquireWakeLock, 10*61*1000L /* 10 minutes 10 seconds */);
    }

    private void updateTokenLoop() {
        tokenUpdateHandler.postDelayed(() -> {
            SharedPreferences sharedPref = getApplicationContext()
                    .getSharedPreferences("CapacitorStorage", Activity.MODE_PRIVATE);
            String refreshToken = sharedPref.getString("refreshToken", null);
            if (refreshToken != null) HTTP.setCurrentRefreshToken(refreshToken);
            updateTokenLoop();
        }, 10 * 1000L /* 10 seconds */);
    }

    private void startSocketWithDelay() {
        Log.d("MotionForegroundService", "Scheduling socket reconnection in 10 seconds...");

        // Cancel any existing pending reconnections to avoid "stacking" sockets
        reconnectHandler.removeCallbacksAndMessages(null);

        reconnectHandler.postDelayed(() -> {
            if (!isRefreshingToken) {
                startSocket();
            }
        }, 10000); // 10 second delay
    }

    private void startSocket() {
        // Prevent overlapping refresh attempts
        if (isConnecting || isRefreshingToken) return;
        isConnecting = true;

        // Cleanup old socket if it exists
        if (mSocket != null) {
            mSocket.disconnect();
            mSocket.off();
        }

        InputStream is;
        try {
            is = getAssets().open("capacitor.config.json");
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        InputStreamReader reader = new InputStreamReader(is);
        JsonObject config = JsonParser.parseReader(reader).getAsJsonObject();
        if (config.has("server")) {
            String baseUrl = config.getAsJsonObject("server").get("url").getAsString();
            SharedPreferences sharedPref = getSharedPreferences("CapacitorStorage", Activity.MODE_PRIVATE);
            String clientId = sharedPref.getString("clientId", null);
            String refreshToken = sharedPref.getString("refreshToken", null);

            HTTP.authenticate(baseUrl, refreshToken, clientId, new HTTP.RefreshTokenCallback() {
                @Override
                public void onSuccess(String newRefreshToken, String token) {
                    isRefreshingToken = false;

                    // Cleanup old socket instance completely
                    if (mSocket != null) {
                        mSocket.disconnect();
                        mSocket.off();
                    }

                    Map<String, String> auth = new HashMap<>();
                    auth.put("clientId", clientId);
                    auth.put("token", token);

                    IO.Options socketOptions = IO.Options.builder()
                            .setAuth(auth)
                            .setTransports(new String[]{"polling", "websocket"})
                            .setReconnection(true)
                            .build();

                    try {
                        mSocket = IO.socket(baseUrl, socketOptions);
                        setupSocketListeners();
                        mSocket.connect();
                    } catch (URISyntaxException e) {
                        Log.e("MotionService", "URI Error: " + e.getMessage());
                    }
                    isConnecting = false;
                }

                @Override
                public void onFailure(String errorMessage) {
                    isRefreshingToken = false;
                    Log.e("MotionForegroundService", "Auth failed: " + errorMessage + ". Retrying in 30s...");
                    // If the server is down, wait longer before trying again
                    reconnectHandler.postDelayed(() -> startSocket(), 30000);
                }
            });
        }
    }

    private void setupSocketListeners() {
        mSocket.on("notification", args -> {
            // Check if we are currently muted
            if (System.currentTimeMillis() < muteUntilTimestamp) {
                Log.d("MotionForegroundService", "Notification suppressed: Mute active for another " +
                        ((muteUntilTimestamp - System.currentTimeMillis()) / 60000) + " minutes.");
                return;
            } else {
                NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                manager.cancel(5543245);
            }

            try {
                if (args.length > 0 && args[0] instanceof JSONObject data) {
                    String streamUrl = data.getString("streamUrl");
                    String cameraId = data.getString("cameraId");
                    String title = data.getString("title");
                    String body = data.getString("body");
                    String icon = data.optString("icon", null);
                    String sound = data.optString("sound", null);
                    String channelId = data.optString("channelId", LOW_EVENT_CHANNEL_ID);
                    String group = data.optString("group", null);

                    try {
                        showSecurityAlert(streamUrl, cameraId, title, body, icon, sound, channelId, group);
                    } catch (IOException e) {
                        Log.e("MotionForegroundService", "Error showing security alert: " + e.getMessage());
                    }
                }
            } catch (JSONException e) {
                Log.e("MotionForegroundService", "Error parsing socket data: " + e.getMessage());
            }
        });

        mSocket.on(Socket.EVENT_CONNECT, args -> {
            Log.d("MotionForegroundService", "Socket connected");
            setIsSocketConnected(true);
        });

        mSocket.on(Socket.EVENT_CONNECT_ERROR, args -> {
            setIsSocketConnected(false);

            // Check if the error is a 401/Unauthorized
            if (args.length > 0) {
                String errorMsg = args[0].toString();
                Log.e("MotionForegroundService", "Socket connect Error: " + errorMsg);

                if (errorMsg.contains("Authentication required")) {
                    Log.d("MotionForegroundService", "Token likely expired, refreshing...");
                    startSocketWithDelay(); // Fully restart the flow with a new token
                } else if (args[0] instanceof JSONObject) {
                    Log.e("MotionForegroundService", "Socket connect Error: " + args[0]);
                    startSocketWithDelay();
                }
            }
        });

        mSocket.on(Socket.EVENT_DISCONNECT, args -> {
            setIsSocketConnected(false);
            // "io server disconnect" means the server kicked us (often token expiration)
            if (args.length > 0 && "io server disconnect".equals(args[0].toString())) {
                startSocketWithDelay();
            }
        });
    }

    private void showSecurityAlert(String streamUrl, String cameraId, String title, String body,
                                   String icon, String sound, String channelId, String group) throws IOException {
        Log.d("MotionForegroundService", "Showing security alert from socket");

        // Use a different ID than the sticky notification so it doesn't overwrite it
        int alertId = (int) System.currentTimeMillis();
        Intent intent = Objects.requireNonNull(getPackageManager()
                .getLaunchIntentForPackage(getPackageName()))
                .setPackage(null)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(streamUrl))
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);

        intent.putExtra(getPackageName() + ".streamUrl", streamUrl);
        intent.putExtra(getPackageName() + ".cameraId", cameraId);
        intent.putExtra(getPackageName() + ".notificationId", alertId);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Bundle extras = new Bundle();
        extras.putString("streamUrl", streamUrl);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setContentTitle(title)
                .setContentText(body)
                .setOnlyAlertOnce(true)
                .setSmallIcon(getApplicationInfo().icon)
                .setColor(Color.parseColor("#2196F3"))
                .setChannelId(channelId)
                .setLights(Color.parseColor("#2196F3"), 500, 500)
                .setVibrate(new long[]{0L, 500L, 500L, 500L})
                .addExtras(extras)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);
        if (icon != null) builder.setSmallIcon(IconCompat.createWithContentUri(Uri.parse("android.resource://" + getPackageName() + "/drawable/" + icon)));
        if (group != null) builder.setGroup(group);

        Intent muteIntent = new Intent(this, MotionForegroundService.class);
        muteIntent.setAction("MUTE_NOTIFS_1H");

        PendingIntent mutePendingIntent = PendingIntent.getService(
                this, alertId - 1, muteIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.addAction(android.R.drawable.ic_lock_silent_mode, "Mute for 1 Hour", mutePendingIntent);

        // if (sound != null) builder.setSound(Uri.parse("android.resource://" + getPackageName() + "/raw/" + sound));
        if (title.equals("Motion Detected!")) {
            builder.setCategory(NotificationCompat.CATEGORY_ALARM);
            builder.setChannelId(EVENT_CHANNEL_ID);
            // res/drawable/push_icon.png
            builder.setSmallIcon(R.drawable.push_icon);

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
                pauseIntent.putExtra(getPackageName() + ".notificationId", alertId);
                pauseIntent.putExtra(getPackageName() + ".clientId", clientId);
                pauseIntent.putExtra(getPackageName() + ".pause", true);

                // Use getBroadcast because we are targeting a BroadcastReceiver
                PendingIntent pausePendingIntent = PendingIntent.getBroadcast(
                        this,
                        alertId, // Unique request code
                        pauseIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

                builder.addAction(android.R.drawable.ic_media_pause, "Pause Detection", pausePendingIntent);
            }
        }

        try {
            NotificationManagerCompat.from(this).notify(alertId, builder.build());
        } catch (SecurityException e) {
            Log.e("MotionForegroundService", "Error showing security alert: " + e.getMessage());
        }
    }

    private Notification getStickyNotification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        assert launchIntent != null;
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentText("[" + (isSocketConnected ? "Connected" : "Disconnected") + "] Monitoring Security System")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setOngoing(true)
                .setGroup("motion_service")
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pendingIntent)
                .build();
    }

    public static void createNotificationChannels(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = ctx.getSystemService(NotificationManager.class);

            // Service notification to keep the service running
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Motion Detection Service",
                    NotificationManager.IMPORTANCE_LOW);
            manager.createNotificationChannel(serviceChannel);

            // Motion notification with custom sound
            Uri soundUri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://"
                    + ctx.getPackageName() + "/" + R.raw.motion_alert);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            NotificationChannel eventChannel = new NotificationChannel(
                    EVENT_CHANNEL_ID,
                    "Motion Event Alerts",
                    NotificationManager.IMPORTANCE_HIGH);
            eventChannel.setSound(soundUri, audioAttributes);
            manager.createNotificationChannel(eventChannel);

            // Less important events than motion
            NotificationChannel lowEventChannel = new NotificationChannel(
                    LOW_EVENT_CHANNEL_ID,
                    "Motion Event Info",
                    NotificationManager.IMPORTANCE_DEFAULT);
            manager.createNotificationChannel(lowEventChannel);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (mSocket != null) {
            mSocket.disconnect();
            mSocket.off();
        }
        if (wakeLock != null) {
            wakeLock.release();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static boolean getIsSocketConnected() {
        return isSocketConnected;
    }

    private boolean setIsSocketConnected(boolean isSocketConnected) {
        MotionForegroundService.isSocketConnected = isSocketConnected;
        try {
            NotificationManagerCompat.from(this).notify(43253643, getStickyNotification());
        } catch (SecurityException e) {
            Log.e("MotionForegroundService", "Error showing sticky notification: " + e.getMessage());
        }
        return MotionForegroundService.isSocketConnected;
    }
}
