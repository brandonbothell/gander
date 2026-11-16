package tld.example.gander.plugins.NativeVideoDownload;

import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.app.NotificationCompat;

@CapacitorPlugin(name = "NativeVideoDownload")
public class NativeVideoDownloadPlugin extends Plugin {
    public static final String DOWNLOAD_PREFERENCES = "video_downloads";
    private static final String CHANNEL_ID = "video_downloads";

    public static String preferenceKey(long downloadId) {
        return "file_name_" + downloadId;
    }

    public static void showDownloadNotification(
            Context context,
            long downloadId,
            String fileName,
            boolean completed,
            boolean successful) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Video downloads",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Status of processed video downloads");
            manager.createNotificationChannel(channel);
        }

        int notificationId = (int) (0x5D000000 | (downloadId & 0x00FFFFFF));
        Intent downloadsIntent = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
        downloadsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                notificationId,
                downloadsIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = !completed
                ? "Downloading file..."
                : successful ? "Download complete" : "Download failed";
        String message = !completed
                ? fileName
                : successful
                        ? fileName + " saved to Downloads."
                        : "Could not download " + fileName + ". Please try again.";
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(context.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(message)
                .setOnlyAlertOnce(true)
                .setOngoing(!completed)
                .setAutoCancel(completed)
                .setContentIntent(contentIntent)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setProgress(0, 0, !completed);

        try {
            manager.notify(notificationId, notification.build());
        } catch (SecurityException error) {
            Log.w("NativeVideoDownload", "Notification permission is unavailable", error);
        }
    }

    @PluginMethod
    public void openDownloads(PluginCall call) {
        Intent intent = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("Could not open the Android Downloads screen: " + error.getMessage());
        }
    }

    @PluginMethod
    public void queueDownload(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        if (url == null || fileName == null || fileName.trim().isEmpty()) {
            call.reject("A download URL and filename are required");
            return;
        }

        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (uri.getHost() == null || (!"http".equals(scheme) && !"https".equals(scheme))) {
            call.reject("The download URL must be an HTTP or HTTPS URL");
            return;
        }

        String safeFileName = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!safeFileName.toLowerCase().endsWith(".mp4")) {
            safeFileName += ".mp4";
        }

        DownloadManager manager =
                (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android's download service is unavailable");
            return;
        }

        try {
            DownloadManager.Request request = new DownloadManager.Request(uri)
                    .setTitle(safeFileName)
                    .setDescription("Downloading processed video")
                    .setMimeType("video/mp4")
                    .setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, safeFileName);

            long downloadId = manager.enqueue(request);
            getContext()
                    .getSharedPreferences(DOWNLOAD_PREFERENCES, Context.MODE_PRIVATE)
                    .edit()
                    .putString(preferenceKey(downloadId), safeFileName)
                    .apply();
            showDownloadNotification(
                    getContext(), downloadId, safeFileName, false, false);

            JSObject result = new JSObject();
            result.put("downloadId", downloadId);
            result.put("fileName", safeFileName);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not queue the video download: " + error.getMessage());
        }
    }
}
