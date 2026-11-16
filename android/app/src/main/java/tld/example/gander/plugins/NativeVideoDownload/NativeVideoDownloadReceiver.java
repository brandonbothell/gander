package tld.example.gander.plugins.NativeVideoDownload;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;

public class NativeVideoDownloadReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;

        long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        if (downloadId < 0) return;

        String preferenceKey = NativeVideoDownloadPlugin.preferenceKey(downloadId);
        String fileName = context
                .getSharedPreferences(
                        NativeVideoDownloadPlugin.DOWNLOAD_PREFERENCES,
                        Context.MODE_PRIVATE)
                .getString(preferenceKey, null);
        if (fileName == null) return;

        DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return;

        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId))) {
            if (cursor == null || !cursor.moveToFirst()) return;

            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL &&
                    status != DownloadManager.STATUS_FAILED) {
                return;
            }

            NativeVideoDownloadPlugin.showDownloadNotification(
                    context,
                    downloadId,
                    fileName,
                    true,
                    status == DownloadManager.STATUS_SUCCESSFUL);
            context.getSharedPreferences(
                            NativeVideoDownloadPlugin.DOWNLOAD_PREFERENCES,
                            Context.MODE_PRIVATE)
                    .edit()
                    .remove(preferenceKey)
                    .apply();
        }
    }
}
