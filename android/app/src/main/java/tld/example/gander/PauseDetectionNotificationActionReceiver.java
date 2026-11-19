package tld.example.gander;

import android.Manifest;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;

import tld.example.gander.API.HTTP;
import tld.example.gander.API.HTTP.APICallback;

import java.util.Objects;
import java.util.Optional;
import java.util.Set;

public class PauseDetectionNotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        KeyguardManager keyguardManager = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguardManager != null && keyguardManager.isKeyguardLocked()) {
            Intent unlockIntent = new Intent(ctx, UnlockTrampolineActivity.class);
            unlockIntent.putExtras(intent); // Forward cameraId, pause, etc.
            unlockIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(unlockIntent);
            return;
        }

        StringBuilder allKeys = new StringBuilder();
        Set<String> keys = Objects.requireNonNull(intent.getExtras()).keySet();
        for (String key : keys) {
            allKeys.append(key).append(" ");
        }
        Log.d("NotificationActionReceiver", "Notification action received, intent extras: " + allKeys);

        String cameraId = intent.getStringExtra(ctx.getPackageName() + ".cameraId");
        String baseUrl = intent.getStringExtra(ctx.getPackageName() + ".baseUrl");
        String clientId = intent.getStringExtra(ctx.getPackageName() + ".clientId");
        boolean pause = intent.getBooleanExtra(ctx.getPackageName() + ".pause", true);
        int notificationId = intent.getIntExtra(ctx.getPackageName() + ".notificationId", 0);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Optional<StatusBarNotification> notificationOptional = NotificationManagerCompat.from(ctx)
                    .getActiveNotifications().stream()
                    .filter(n -> n.getId() == notificationId)
                    .findFirst();
            if (notificationOptional.isPresent()) {
                StatusBarNotification notification = notificationOptional.get();
                Notification notificationObj = notification.getNotification();
                notificationObj.actions[1].title = "Loading...";
                notificationObj.actions[1].actionIntent = null;

                if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    // TODO: Consider calling
                    //    ActivityCompat#requestPermissions
                    // here to request the missing permissions, and then overriding
                    //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
                    //                                          int[] grantResults)
                    // to handle the case where the user grants the permission. See the documentation
                    // for ActivityCompat#requestPermissions for more details.
                    return;
                }
                NotificationManagerCompat.from(ctx).notify(notificationId, notificationObj);
                Log.d("NotificationActionReceiver", "Notification action updated");
            } else {
                Log.w("NotificationActionReceiver", "Notification not found for update");
            }
        } else {
            NotificationManagerCompat.from(ctx).cancel(notificationId);
        }

        // 2. Execute Retrofit Call
        assert baseUrl != null;
        assert clientId != null;
        HTTP.setMotionPaused(baseUrl, clientId, cameraId, pause, new APICallback() {
            @Override
            public void onSuccess() {
                updateNotification(ctx, notificationId, cameraId, baseUrl, clientId, pause);
            }

            @Override
            public void onFailure(String errorMessage) {
                updateNotification(ctx, notificationId, cameraId, baseUrl, clientId, !pause);
            }
        });
    }

    private void updateNotification(Context ctx, int notificationId, String cameraId, String baseUrl, String clientId, Boolean didPause) {
        // Edit notification action
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Optional<StatusBarNotification> notificationOptional = NotificationManagerCompat.from(ctx)
                    .getActiveNotifications().stream()
                    .filter(n -> n.getId() == notificationId)
                    .findFirst();
            if (notificationOptional.isPresent()) {
                Intent nextIntent = new Intent(ctx, PauseDetectionNotificationActionReceiver.class)
                    .putExtra(ctx.getPackageName() + ".cameraId", cameraId)
                    .putExtra(ctx.getPackageName() + ".baseUrl", baseUrl)
                    .putExtra(ctx.getPackageName() + ".notificationId", notificationId)
                    .putExtra(ctx.getPackageName() + ".clientId", clientId)
                    .putExtra(ctx.getPackageName() + ".pause", !didPause);

                StatusBarNotification notification = notificationOptional.get();
                Notification notificationObj = notification.getNotification();
                String newTitle = didPause ? "Start Detection" : "Pause Detection";
                int newIcon = didPause ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause;
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                        ctx,
                        notificationId + 1, // Unique request code
                        nextIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

                notificationObj.actions[1] = new Notification.Action.Builder(
                        android.graphics.drawable.Icon.createWithResource(ctx, newIcon),
                        newTitle,
                        pendingIntent
                )
                        // .setAuthenticationRequired(true)
                        // .setContextual(true)
                        .build();

                if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    // TODO: Consider calling
                    //    ActivityCompat#requestPermissions
                    // here to request the missing permissions, and then overriding
                    //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
                    //                                          int[] grantResults)
                    // to handle the case where the user grants the permission. See the documentation
                    // for ActivityCompat#requestPermissions for more details.
                    return;
                }
                NotificationManagerCompat.from(ctx).notify(notificationId, notificationObj);

                Log.d("NotificationActionReceiver", "Notification action updated");

                NotificationManagerCompat.from(ctx).getActiveNotifications().stream()
                        .filter(n -> n.getId() != notificationId &&
                                (n.getNotification().extras.getString(Notification.EXTRA_TITLE) == null ||
                                !n.getNotification().extras.getString(Notification.EXTRA_TITLE).endsWith(didPause ? "Paused" : "Resumed")))
                        .forEach(n -> NotificationManagerCompat.from(ctx).cancel(n.getId()));
            }
        } else {
            NotificationManagerCompat.from(ctx).cancel(notificationId);
        }
    }
}
