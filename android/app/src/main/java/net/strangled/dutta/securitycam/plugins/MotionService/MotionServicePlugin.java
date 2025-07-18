package net.strangled.dutta.securitycam.plugins.MotionService;

import android.content.Intent;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MotionService")
public class MotionServicePlugin extends Plugin {

  @PluginMethod
  public void startService(PluginCall call) {
    Context context = getContext();
    Intent serviceIntent = new Intent(context, MotionForegroundService.class);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(serviceIntent);
      } else {
          context.startService(serviceIntent);
      }
      call.resolve();
  }

  @PluginMethod
  public void stopService(PluginCall call) {
    Context context = getContext();
    Intent serviceIntent = new Intent(context, MotionForegroundService.class);
    context.stopService(serviceIntent);
    call.resolve();
  }
}
