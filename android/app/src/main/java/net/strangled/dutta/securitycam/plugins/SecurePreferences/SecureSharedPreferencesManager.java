package net.strangled.dutta.securitycam.plugins.SecurePreferences;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import net.strangled.dutta.securitycam.API.HTTP;

import java.io.IOException;
import java.security.GeneralSecurityException;

public class SecureSharedPreferencesManager {
    private final String filename = "capacitorapp_encrypedsharedpreferences";
    private static SecureSharedPreferencesManager instance;
    private SharedPreferences sharedPreferences;

    public static synchronized SecureSharedPreferencesManager getInstance(Context context) {
        if (instance == null) {
            instance = new SecureSharedPreferencesManager(context.getApplicationContext());
            HTTP.setEncryptedSharedPreferences(instance);
        }
        return instance;
    }

    private SecureSharedPreferencesManager(Context ctx) {
        MasterKey masterKey = null;
        try {
            masterKey = new MasterKey.Builder(ctx)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
        } catch (GeneralSecurityException | IOException e) {
            Log.e("SecurePreferencesPlugin", "Failed to generate master key", e);
            return;
        }

        try {
            sharedPreferences = EncryptedSharedPreferences.create(
                    ctx,
                    filename,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (GeneralSecurityException | IOException e) {
            Log.e("SecurePreferencesPlugin", "Failed to create/load shared preferences file", e);
        }
    }

    public String getStringOrNull(String key) {
        return sharedPreferences.getString(key, null);
    }

    public void setString(String key, String value) {
        SharedPreferences.Editor editor = sharedPreferences.edit();
        editor.putString(key, value);
        editor.commit();
    }

    public void unset(String key) {
        SharedPreferences.Editor editor = sharedPreferences.edit();
        editor.remove(key);
        editor.commit();
    }

    public SharedPreferences.Editor getEditor() {
        return sharedPreferences.edit();
    }
}
