package net.strangled.dutta.securitycam.plugins.AppIntegrityCheck;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppIntegrityCheck")
public class AppIntegrityCheckPlugin extends Plugin {
    private AppIntegrityCheckManager manager;

    @Override
    public void load() {
        super.load();
        manager = AppIntegrityCheckManager.getInstance();
    }

    @PluginMethod
    public void getAppCheckToken(PluginCall call) {
        manager.getAppCheckToken(token -> {
            call.resolve(new JSObject().put("token", token));
        }, error -> {
            Log.e("AppIntegrityCheckPlugin", "Error getting app check token:", error);
            call.resolve(new JSObject().put("error", error.getMessage()));
        });
    }
}
