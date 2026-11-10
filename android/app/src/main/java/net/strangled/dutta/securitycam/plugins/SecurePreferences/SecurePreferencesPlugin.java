package net.strangled.dutta.securitycam.plugins.SecurePreferences;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecurePreferences")
public class SecurePreferencesPlugin extends Plugin {
    private final String filename = "capacitorapp_encrypedsharedpreferences";
    private SecureSharedPreferencesManager sharedPreferences;

    @Override
    public void load() {
        super.load();
        sharedPreferences = SecureSharedPreferencesManager.getInstance(getContext());
    }

    @PluginMethod
    @Nullable
    public void getStringOrNull(PluginCall call) {
        if (call.getString("key") == null) return;
        call.resolve(new JSObject().put("value", sharedPreferences.getStringOrNull(call.getString("key"))));
    }

    @PluginMethod
    public void setString(PluginCall call) {
        if (call.getString("key") == null || call.getString("value") == null) return;
        sharedPreferences.setString(call.getString("key"), call.getString("value"));
        call.resolve();
    }

    @PluginMethod
    public void unset(PluginCall call) {
        if (call.getString("key") == null) return;
        sharedPreferences.unset(call.getString("key"));
        call.resolve();
    }
}
