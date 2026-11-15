package tld.example.gander;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.content.ContextCompat;

import tld.example.gander.plugins.MotionService.MotionForegroundService;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d("BootReceiver", "Device rebooted, restarting MotionForegroundService...");

            Intent serviceIntent = new Intent(context, MotionForegroundService.class);

            // Use ContextCompat to handle the version-specific startForegroundService call
            ContextCompat.startForegroundService(context, serviceIntent);
        }
    }
}

