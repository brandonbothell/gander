package net.strangled.dutta.securitycam.plugins.AppIntegrityCheck;

import com.google.firebase.appcheck.FirebaseAppCheck;

import java.util.function.Consumer;

public class AppIntegrityCheckManager {
    private FirebaseAppCheck appCheck;
    private static AppIntegrityCheckManager instance;

    public static synchronized AppIntegrityCheckManager getInstance() {
        if (instance != null) return instance;
        return new AppIntegrityCheckManager();
    }

    private AppIntegrityCheckManager () {
        instance = this;
        appCheck = FirebaseAppCheck.getInstance();
    }

    public void getAppCheckToken (Consumer<String> onSuccess, Consumer<Exception> onFailure) {
        appCheck.getLimitedUseAppCheckToken()
                .addOnSuccessListener(appCheckTokenResponse -> {
                    onSuccess.accept(appCheckTokenResponse.getToken());
                })
                .addOnFailureListener(onFailure::accept);
    }
}
