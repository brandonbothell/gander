package net.strangled.dutta.securitycam;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import net.strangled.dutta.securitycam.plugins.BatteryOptimization.BatteryOptimizationPlugin;
import net.strangled.dutta.securitycam.plugins.MotionService.MotionServicePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(MotionServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
