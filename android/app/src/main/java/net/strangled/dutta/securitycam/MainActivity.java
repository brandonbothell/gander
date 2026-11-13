package net.strangled.dutta.securitycam;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.AppCheckProviderFactory;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;

import net.strangled.dutta.securitycam.plugins.AppIntegrityCheck.AppIntegrityCheckPlugin;
import net.strangled.dutta.securitycam.plugins.BatteryOptimization.BatteryOptimizationPlugin;
import net.strangled.dutta.securitycam.plugins.MotionService.MotionServicePlugin;
import net.strangled.dutta.securitycam.plugins.SecurePreferences.SecurePreferencesPlugin;

public class MainActivity extends BridgeActivity {
    public static String userAgent = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        FirebaseApp.initializeApp(getApplicationContext());
        FirebaseAppCheck firebaseAppCheck = FirebaseAppCheck.getInstance();

        Log.d("OnCreate", "Build in debug mode: " + BuildConfig.DEBUG);
        if (BuildConfig.DEBUG) {
            try {
                Class<?> debugFactoryClass = Class.forName("com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory");
                AppCheckProviderFactory factory = (AppCheckProviderFactory) debugFactoryClass.getMethod("getInstance").invoke(null);
                assert factory != null;
                firebaseAppCheck.installAppCheckProviderFactory(factory);
            } catch (Exception e) {
                Log.e("OnCreate", "Error initializing debug app check provider: ", e);
            }
        }
        else firebaseAppCheck.installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance());

        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(MotionServicePlugin.class);
        registerPlugin(SecurePreferencesPlugin.class);
        registerPlugin(AppIntegrityCheckPlugin.class);

        super.onCreate(savedInstanceState);
    }

    @Override
    public void load() {
        // Do stuff here to access methods on the bridge
        super.load();

        userAgent = getBridge().getWebView().getSettings().getUserAgentString();
    }
}
