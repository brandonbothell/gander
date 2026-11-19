package tld.example.gander;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

public class UnlockTrampolineActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguardManager != null && keyguardManager.isKeyguardLocked()) {
            keyguardManager.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    Log.d("UnlockTrampoline", "Device unlocked, executing action");
                    forwardActionToReceiver();
                    finish();
                }

                @Override
                public void onDismissCancelled() {
                    Log.d("UnlockTrampoline", "Unlock cancelled by user");
                    finish();
                }

                @Override
                public void onDismissError() {
                    Log.e("UnlockTrampoline", "Error dismissing keyguard");
                    finish();
                }
            });
        } else {
            // Already unlocked (or API < 26)
            forwardActionToReceiver();
            finish();
        }
    }

    private void forwardActionToReceiver() {
        Intent receiverIntent = new Intent(this, PauseDetectionNotificationActionReceiver.class);
        if (getIntent() != null && getIntent().getExtras() != null) {
            receiverIntent.putExtras(getIntent().getExtras());
        }
        sendBroadcast(receiverIntent);
    }
}
