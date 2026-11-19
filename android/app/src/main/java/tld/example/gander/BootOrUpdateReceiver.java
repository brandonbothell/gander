package tld.example.gander;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.content.ContextCompat;

import tld.example.gander.plugins.MotionService.MotionForegroundService;

public class BootOrUpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            Log.d("BootOrUpdateReceiver", "Restarting MotionForegroundService after " + intent.getAction());

            Intent serviceIntent = new Intent(context, MotionForegroundService.class);
            ContextCompat.startForegroundService(context, serviceIntent);
        }
    }
}
