package tld.example.gander.plugins.NativeVideoDownload;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeVideoDownload")
public class NativeVideoDownloadPlugin extends Plugin {

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
            JSObject result = new JSObject();
            result.put("downloadId", downloadId);
            result.put("fileName", safeFileName);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not queue the video download: " + error.getMessage());
        }
    }
}
