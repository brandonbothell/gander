package net.strangled.dutta.securitycam.plugins.MotionService;

import android.content.Intent;
import android.content.Context;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MotionService")
public class MotionServicePlugin extends Plugin {

    @PluginMethod
    public void startService(PluginCall call) {
        Context ctx = getContext();
        Intent serviceIntent = new Intent(ctx, MotionForegroundService.class);
        ContextCompat.startForegroundService(ctx, serviceIntent);
        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Context ctx = getContext();
        Intent serviceIntent = new Intent(ctx, MotionForegroundService.class);
        ctx.stopService(serviceIntent);
        call.resolve();
    }
}
