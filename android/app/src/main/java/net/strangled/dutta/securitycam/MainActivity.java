package net.strangled.dutta.securitycam;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import net.strangled.dutta.securitycam.plugins.BatteryOptimization.BatteryOptimizationPlugin;
import net.strangled.dutta.securitycam.plugins.MotionService.MotionServicePlugin;
import net.strangled.dutta.securitycam.plugins.SecurePreferences.SecurePreferencesPlugin;

public class MainActivity extends BridgeActivity {
    public static String userAgent = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(MotionServicePlugin.class);
        registerPlugin(SecurePreferencesPlugin.class);

        super.onCreate(savedInstanceState);
    }

    @Override
    public void load() {
        // Do stuff here to access methods on the bridge
        super.load();

        userAgent = getBridge().getWebView().getSettings().getUserAgentString();
    }
}
