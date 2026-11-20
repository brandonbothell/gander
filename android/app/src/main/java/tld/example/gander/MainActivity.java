package tld.example.gander;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.AppCheckProviderFactory;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;

import tld.example.gander.plugins.AppIntegrityCheck.AppIntegrityCheckPlugin;
import tld.example.gander.plugins.BatteryOptimization.BatteryOptimizationPlugin;
import tld.example.gander.plugins.LiveUpdate.LiveUpdatePlugin;
import tld.example.gander.plugins.MotionService.MotionServicePlugin;
import tld.example.gander.plugins.NativeVideoDownload.NativeVideoDownloadPlugin;
import tld.example.gander.plugins.SecurePreferences.SecurePreferencesPlugin;

public class MainActivity extends BridgeActivity {
    public static String userAgent = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        FirebaseApp.initializeApp(getApplicationContext());
        FirebaseAppCheck firebaseAppCheck = FirebaseAppCheck.getInstance();

        Log.d("OnCreate", "Build in debug mode: " + BuildConfig.DEBUG);
        if (BuildConfig.DEBUG) {
            try {
                Class<?> debugFactoryClass = Class
                        .forName("com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory");
                AppCheckProviderFactory factory = (AppCheckProviderFactory) debugFactoryClass.getMethod("getInstance")
                        .invoke(null);
                assert factory != null;
                firebaseAppCheck.installAppCheckProviderFactory(factory);
            } catch (Exception e) {
                Log.e("OnCreate", "Error initializing debug app check provider: ", e);
            }
        } else
            firebaseAppCheck.installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance());

        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(MotionServicePlugin.class);
        registerPlugin(NativeVideoDownloadPlugin.class);
        registerPlugin(SecurePreferencesPlugin.class);
        registerPlugin(AppIntegrityCheckPlugin.class);
        registerPlugin(LiveUpdatePlugin.class);

        super.onCreate(savedInstanceState);
    }

    @Override
    public void load() {
        // Do stuff here to access methods on the bridge
        super.load();

        String updateBundlePath = LiveUpdatePlugin.resolveBootBundlePath(this);
        if (updateBundlePath != null && this.bridge != null) {
            this.bridge.setServerBasePath(updateBundlePath);
        }

        userAgent = getBridge().getWebView().getSettings().getUserAgentString();
    }
}
