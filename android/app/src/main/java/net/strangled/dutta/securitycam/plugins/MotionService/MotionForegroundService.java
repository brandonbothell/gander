package net.strangled.dutta.securitycam.plugins.MotionService;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

public class MotionForegroundService extends Service {
    private static final String CHANNEL_ID = "motion_service_channel";
    private static final String EVENT_CHANNEL_ID = "motion_event_channel";
    private static final String LOW_EVENT_CHANNEL_ID = "motion_event_low_channel";

    @Override
    public void onCreate() {
        super.onCreate();
        android.util.Log.d("MotionForegroundService", "Service created");
        createNotificationChannels();

        // Create an intent to launch the app's main activity
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = null;
        if (launchIntent != null) {
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pendingIntent = PendingIntent.getActivity(
                    this,
                    0,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentText("Notification service is active")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setOngoing(true)
                .setGroup("motion_service")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pendingIntent) // Open app when tapped
                // .setAutoCancel(false) // Not needed, ongoing+foreground prevents swipe away
                .build();
        startForeground(43253643, notification);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Service logic here (if needed)
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        android.util.Log.d("MotionForegroundService", "Service destroyed");
        // You can also add other cleanup code here if needed
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);

            // Service notification to keep the service running
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "Motion Detection Service",
                    NotificationManager.IMPORTANCE_LOW);
            manager.createNotificationChannel(serviceChannel);

            // Motion notification with custom sound
            Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/motion_alert");
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
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
}
