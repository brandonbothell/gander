package tld.example.gander.plugins.LiveUpdate;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.json.JSONObject;

@CapacitorPlugin(name = "LiveUpdate")
public class LiveUpdatePlugin extends Plugin {

  private static final String TAG = "LiveUpdate";
  private static final String PREFS_NAME = "capacitor_liveupdate_prefs";
  private static final String KEY_ACTIVE_PATH = "active_bundle_path";
  private static final String KEY_PENDING_PATH = "pending_bundle_path";
  private static final String KEY_BOOT_ATTEMPTED = "boot_attempted";
  private static final String KEY_BOOT_CONFIRMED = "boot_confirmed";
  private static final String KEY_CURRENT_VERSION = "current_liveupdate_version";

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  @Override
  public void load() {
    if (getPublicKeyBase64() == null)
      return;

    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    String pendingPath = prefs.getString(KEY_PENDING_PATH, null);
    boolean bootAttempted = prefs.getBoolean(KEY_BOOT_ATTEMPTED, false);
    boolean bootConfirmed = prefs.getBoolean(KEY_BOOT_CONFIRMED, true);

    String pathToLoad = null;

    if (pendingPath != null) {
      if (bootAttempted && !bootConfirmed) {
        // Case 1: Previous boot crashed or froze before notifyAppReady() -> Roll back!
        Log.w(TAG, "Unconfirmed Live Update boot detected. Rolling back to previous bundle.");
        prefs.edit()
            .remove(KEY_PENDING_PATH)
            .putBoolean(KEY_BOOT_ATTEMPTED, false)
            .putBoolean(KEY_BOOT_CONFIRMED, true)
            .apply();

        deleteRecursively(new File(pendingPath));

        String fallbackPath = prefs.getString(KEY_ACTIVE_PATH, null);
        if (fallbackPath != null && new File(fallbackPath).exists()) {
          pathToLoad = fallbackPath;
        }
      } else if (!bootAttempted && new File(pendingPath).exists()) {
        // Case 2: Freshly staged bundle ready for its first boot -> Mark attempted and
        // queue load
        Log.i(TAG, "Applying staged Live Update bundle on boot: " + pendingPath);
        prefs.edit()
            .putBoolean(KEY_BOOT_ATTEMPTED, true)
            .putBoolean(KEY_BOOT_CONFIRMED, false)
            .apply();

        pathToLoad = pendingPath;
      }
    } else {
      // Case 3: Normal boot with active bundle
      String activePath = prefs.getString(KEY_ACTIVE_PATH, null);
      if (activePath != null && new File(activePath).exists()) {
        pathToLoad = activePath;
      }
    }

    // Defer setServerBasePath until after Bridge finishes initializing localServer
    // & WebView
    if (pathToLoad != null) {
      final String finalPath = pathToLoad;
      Log.d(TAG, "Setting server base path to: " + finalPath);
      new Handler(Looper.getMainLooper()).post(() -> {
        if (bridge != null) {
          try {
            bridge.setServerBasePath(finalPath);
          } catch (Exception e) {
            Log.e(TAG, "Error setting server base path: ", e);
          }
        }
      });
    }
  }

  @PluginMethod
  public void notifyAppReady(PluginCall call) {
    if (getPublicKeyBase64() == null)
      return;
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    String pendingPath = prefs.getString(KEY_PENDING_PATH, null);
    String oldActivePath = prefs.getString(KEY_ACTIVE_PATH, null);

    if (pendingPath != null && new File(pendingPath).exists()) {
      prefs.edit()
          .putString(KEY_ACTIVE_PATH, pendingPath)
          .remove(KEY_PENDING_PATH)
          .putBoolean(KEY_BOOT_ATTEMPTED, false)
          .putBoolean(KEY_BOOT_CONFIRMED, true)
          .apply();

      if (oldActivePath != null && !oldActivePath.equals(pendingPath)) {
        deleteRecursively(new File(oldActivePath));
      }
      Log.i(TAG, "Live Update bundle confirmed and promoted to active: " + pendingPath);
    } else {
      prefs.edit()
          .putBoolean(KEY_BOOT_ATTEMPTED, false)
          .putBoolean(KEY_BOOT_CONFIRMED, true)
          .apply();
    }

    call.resolve();
  }

  @PluginMethod
  public void downloadAndPrepare(PluginCall call) {
    if (getPublicKeyBase64() == null)
      return;
    String downloadUrl = call.getString("url");
    String signatureBase64 = call.getString("signature");

    if (downloadUrl == null || signatureBase64 == null) {
      call.reject("Missing required parameters: url, and signature are required.");
      return;
    }

    executor.execute(() -> {
      long key = System.currentTimeMillis();
      File tempZip = new File(getContext().getCacheDir(), "liveupdate_" + key + ".zip");
      File stagingDir = new File(getContext().getFilesDir(), "liveupdate_bundles/" + key);

      try {
        // Download zip over HTTPS
        downloadFile(downloadUrl, tempZip);

        // Cryptographically verify ECDSA P-256 signature BEFORE extracting
        if (!verifySignature(tempZip, signatureBase64)) {
          tempZip.delete();
          call.reject("Cryptographic signature verification failed. Update rejected.");
          return;
        }

        // Extract safely with Zip Slip protection
        if (stagingDir.exists()) {
          deleteRecursively(stagingDir);
        }
        unzipSafely(tempZip, stagingDir);
        tempZip.delete();

        // Verify index.html exists at root of extracted bundle
        File indexFile = new File(stagingDir, "index.html");
        if (!indexFile.exists()) {
          deleteRecursively(stagingDir);
          call.reject("Invalid bundle: index.html missing at archive root.");
          return;
        }

        // Read the cryptographically signed manifest.json
        File manifestFile = new File(stagingDir, "manifest.json");
        if (!manifestFile.exists()) {
          deleteRecursively(stagingDir);
          call.reject("Invalid bundle: missing signed manifest.json.");
          return;
        }

        String manifestJsonStr = new String(Files.readAllBytes(manifestFile.toPath()), StandardCharsets.UTF_8);
        JSONObject manifest = new JSONObject(manifestJsonStr);
        String verifiedVersion = manifest.getString("version");

        // Read the current version saved by React in Capacitor Preferences
        SharedPreferences capPrefs = getContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String currentVersion = capPrefs.getString("reactAppVersion", "1.0.0");

        // 3. Prevent downgrade / replay attacks (enforce verifiedVersion >
        // currentVersion)
        if (compareSemVer(verifiedVersion, currentVersion) <= 0) {
          deleteRecursively(stagingDir);
          call.reject("Rejected bundle version " + verifiedVersion + ": must be newer than current " + currentVersion);
          return;
        }

        // 4. Move stagingDir to final versioned folder and mark pending
        File finalDir = new File(getContext().getFilesDir(), "liveupdate_bundles/" + verifiedVersion);
        if (finalDir.exists()) {
          deleteRecursively(finalDir);
        }
        if (!stagingDir.renameTo(finalDir)) {
          deleteRecursively(stagingDir);
          call.reject("Failed to promote staged bundle directory.");
          return;
        }

        // 4. Stage bundle as pending (will be tested on next boot or reload)
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_PENDING_PATH, finalDir.getAbsolutePath())
            .putString(KEY_CURRENT_VERSION, verifiedVersion)
            .putBoolean(KEY_BOOT_ATTEMPTED, false)
            .putBoolean(KEY_BOOT_CONFIRMED, false)
            .apply();

        JSObject result = new JSObject();
        result.put("version", verifiedVersion);
        result.put("path", finalDir.getAbsolutePath());
        call.resolve(result);

      } catch (Exception e) {
        if (tempZip.exists())
          tempZip.delete();
        if (stagingDir.exists())
          deleteRecursively(stagingDir);
        Log.e(TAG, "Live Update failed", e);
        call.reject("Live Update failed: " + e.getMessage());
      }
    });
  }

  @PluginMethod
  public void applyPending(PluginCall call) {
    if (getPublicKeyBase64() == null)
      return;
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    String pendingPath = prefs.getString(KEY_PENDING_PATH, null);

    if (pendingPath == null || !new File(pendingPath).exists()) {
      call.reject("No valid pending bundle found to apply.");
      return;
    }

    // Mark boot_attempted = true BEFORE reloading so if the new bundle crashes
    // immediately,
    // the next cold start will know a boot was attempted and roll back!
    prefs.edit()
        .putBoolean(KEY_BOOT_ATTEMPTED, true)
        .putBoolean(KEY_BOOT_CONFIRMED, false)
        .apply();

    getActivity().runOnUiThread(() -> {
      bridge.setServerBasePath(pendingPath);
      call.resolve();
    });
  }

  private void downloadFile(String urlString, File destination) throws IOException, URISyntaxException {
    URL url = new URI(urlString).toURL();
    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
    conn.setConnectTimeout(15000);
    conn.setReadTimeout(30000);
    conn.setRequestMethod("GET");

    if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
      throw new IOException("HTTP error code: " + conn.getResponseCode());
    }

    try (InputStream in = new BufferedInputStream(conn.getInputStream());
        FileOutputStream out = new FileOutputStream(destination)) {
      byte[] buffer = new byte[8192];
      int bytesRead;
      while ((bytesRead = in.read(buffer)) != -1) {
        out.write(buffer, 0, bytesRead);
      }
    } finally {
      conn.disconnect();
    }
  }

  private boolean verifySignature(File file, String signatureBase64) throws Exception {
    String pubKey = getPublicKeyBase64();
    if (pubKey == null)
      return false;
    byte[] keyBytes = Base64.decode(pubKey, Base64.DEFAULT);
    X509EncodedKeySpec keySpec = new X509EncodedKeySpec(keyBytes);
    KeyFactory keyFactory = KeyFactory.getInstance("EC");
    PublicKey publicKey = keyFactory.generatePublic(keySpec);

    Signature signature = Signature.getInstance("SHA256withECDSA");
    signature.initVerify(publicKey);

    try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
      byte[] buffer = new byte[8192];
      int bytesRead;
      while ((bytesRead = in.read(buffer)) != -1) {
        signature.update(buffer, 0, bytesRead);
      }
    }

    byte[] sigBytes = Base64.decode(signatureBase64, Base64.DEFAULT);
    return signature.verify(sigBytes);
  }

  private void unzipSafely(File zipFile, File destDir) throws IOException {
    if (!destDir.mkdirs() && !destDir.isDirectory()) {
      throw new IOException("Failed to create destination directory: " + destDir);
    }

    String canonicalDestPath = destDir.getCanonicalPath() + File.separator;

    try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
      ZipEntry entry;
      byte[] buffer = new byte[8192];

      while ((entry = zis.getNextEntry()) != null) {
        File outFile = new File(destDir, entry.getName());
        String canonicalOutPath = outFile.getCanonicalPath();

        // Guard against Zip Slip path traversal
        if (!canonicalOutPath.startsWith(canonicalDestPath)) {
          throw new SecurityException("Zip Slip blocked: " + entry.getName());
        }

        if (entry.isDirectory()) {
          if (!outFile.mkdirs() && !outFile.isDirectory()) {
            throw new IOException("Failed to create directory: " + outFile);
          }
        } else {
          File parent = outFile.getParentFile();
          if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Failed to create parent directory: " + parent);
          }
          try (FileOutputStream fos = new FileOutputStream(outFile)) {
            int len;
            while ((len = zis.read(buffer)) > 0) {
              fos.write(buffer, 0, len);
            }
          }
        }
        zis.closeEntry();
      }
    }
  }

  private void deleteRecursively(File fileOrDir) {
    if (fileOrDir == null || !fileOrDir.exists())
      return;

    if (fileOrDir.isDirectory()) {
      File[] children = fileOrDir.listFiles();
      if (children != null) {
        for (File child : children) {
          deleteRecursively(child);
        }
      }
    }

    fileOrDir.delete();
  }

  private String getPublicKeyBase64() {
    String key = getConfig().getString("publicKey");
    if (key == null || key.isEmpty()) {
      return null;
    }
    return key;
  }

  private int compareSemVer(String v1, String v2) {
    String[] parts1 = v1.replaceAll("[^0-9.]", "").split("\\.");
    String[] parts2 = v2.replaceAll("[^0-9.]", "").split("\\.");
    int length = Math.max(parts1.length, parts2.length);

    for (int i = 0; i < length; i++) {
      int num1 = i < parts1.length && !parts1[i].isEmpty() ? Integer.parseInt(parts1[i]) : 0;
      int num2 = i < parts2.length && !parts2[i].isEmpty() ? Integer.parseInt(parts2[i]) : 0;
      if (num1 != num2) {
        return Integer.compare(num1, num2);
      }
    }
    return 0;
  }
}
