package net.strangled.dutta.securitycam;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import net.strangled.dutta.securitycam.API.HTTP;
import net.strangled.dutta.securitycam.plugins.BatteryOptimization.BatteryOptimizationPlugin;
import net.strangled.dutta.securitycam.plugins.MotionService.MotionServicePlugin;

public class MainActivity extends BridgeActivity {
    public static String userAgent = null;
    public static String platform = "Linux";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        HTTP.sharedPreferences = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(MotionServicePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void load() {
        // Do stuff here to access methods on the bridge
        super.load();

        userAgent = getBridge().getWebView().getSettings().getUserAgentString();
    }
}
