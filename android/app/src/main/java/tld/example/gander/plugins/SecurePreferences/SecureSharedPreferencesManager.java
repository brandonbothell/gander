package tld.example.gander.plugins.SecurePreferences;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import tld.example.gander.API.HTTP;

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
        MasterKey masterKey;
        try {
            masterKey = new MasterKey.Builder(ctx)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
        } catch (GeneralSecurityException | IOException e) {
            Log.e("SecurePreferencesPlugin", "Failed to generate master key", e);
            return;
        }

        try {
            sharedPreferences = createEncryptedPrefs(ctx, masterKey);
        } catch (GeneralSecurityException | IOException e) {
            Log.w("SecurePreferencesPlugin", "Corrupted or restored preferences detected; resetting file", e);
            // Delete the unreadable preferences file (likely restored by Auto Backup) and recreate
            ctx.deleteSharedPreferences(filename);
            try {
                sharedPreferences = createEncryptedPrefs(ctx, masterKey);
            } catch (GeneralSecurityException | IOException retryEx) {
                Log.e("SecurePreferencesPlugin", "Failed to recreate shared preferences file", retryEx);
            }
        }
    }

    private SharedPreferences createEncryptedPrefs(Context ctx, MasterKey masterKey)
            throws GeneralSecurityException, IOException {
        return EncryptedSharedPreferences.create(
                ctx,
                filename,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
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
