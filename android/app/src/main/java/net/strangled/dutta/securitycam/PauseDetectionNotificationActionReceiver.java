package net.strangled.dutta.securitycam;

import android.Manifest;
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

import net.strangled.dutta.securitycam.API.HTTP;

import java.util.Objects;
import java.util.Optional;
import java.util.Set;

public class PauseDetectionNotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
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

        // 1. Edit notification action to "Unpause Detection"
//        NotificationManagerCompat.from(ctx).cancel(notificationId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Optional<StatusBarNotification> notificationOptional = NotificationManagerCompat.from(ctx)
                    .getActiveNotifications().stream()
                    .filter(n -> n.getId() == notificationId)
                    .findFirst();
            if (notificationOptional.isPresent()) {
                Intent startIntent = new Intent(ctx, PauseDetectionNotificationActionReceiver.class)
                    .putExtra(ctx.getPackageName() + ".cameraId", cameraId)
                    .putExtra(ctx.getPackageName() + ".baseUrl", baseUrl)
                    .putExtra(ctx.getPackageName() + ".notificationId", notificationId)
                    .putExtra(ctx.getPackageName() + ".clientId", clientId)
                    .putExtra(ctx.getPackageName() + ".pause", !pause);

                StatusBarNotification notification = notificationOptional.get();
                Notification notificationObj = notification.getNotification();
                notificationObj.actions[0].title = pause ? "Start Detection" : "Pause Detection";
                notificationObj.actions[0].actionIntent = PendingIntent.getBroadcast(
                        ctx,
                        notificationId + 1, // Unique request code
                        startIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

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
                        .filter(n -> n.getId() != notificationId)
                        .forEach(n -> NotificationManagerCompat.from(ctx).cancel(n.getId()));
            }
        } else {
            NotificationManagerCompat.from(ctx).cancel(notificationId);
        }

        // 2. Execute Retrofit Call
        assert baseUrl != null;
        assert clientId != null;
        HTTP.setMotionPaused(baseUrl, clientId, cameraId, pause, null);
    }
}
