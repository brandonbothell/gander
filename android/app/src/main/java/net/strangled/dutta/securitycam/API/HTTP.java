package net.strangled.dutta.securitycam.API;

import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;

import com.google.gson.JsonObject;

import net.strangled.dutta.securitycam.MainActivity;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;
import retrofit2.internal.EverythingIsNonNull;

public class HTTP {
    private static float lastRefreshed = 0F;
    private static int refreshFailuresInARow = 0;

    private static String dontTryThisTokenAgain = null;
    private static String currentStatusToken = null;
    private static String currentRefreshToken = null;
    private static String currentToken = null;
    public static SharedPreferences sharedPreferences = null;
    private static boolean refreshingToken = false;

    public interface APICallback {
        void onSuccess();
        void onFailure(String errorMessage);
    }

    public static void setMotionPaused(String baseUrl, String clientId, String streamId,
                                       boolean paused, @Nullable APICallback callback) {
        assert baseUrl != null;
        String currentToken = sharedPreferences.getString("token", null);

        if (currentToken == null || !isTokenValidAndNotExpiring(currentToken, 10)) {
            Log.i("SetMotionPaused", "Need new token, checking if refreshing already...");
            if (!refreshingToken) {
                Log.i("SetMotionPaused", "Refreshing now");
                refreshingToken = true;
                authenticate(baseUrl, null, clientId, new RefreshTokenCallback() {
                    @Override
                    public void onSuccess(String refreshToken, String token) {
                        refreshingToken = false;
                        setMotionPaused(baseUrl, clientId, streamId, paused, callback);
                    }

                    @Override
                    public void onFailure(String errorMessage) {
                        refreshingToken = false;
                        Log.e("SetMotionPaused", "Failed to refresh token");
                    }
                });
            }
            return;
        }

        Retrofit retrofit = new Retrofit.Builder()
                .baseUrl(baseUrl)
                .addConverterFactory(GsonConverterFactory.create())
                .build();

        JsonObject pauseBody = new JsonObject();
        pauseBody.addProperty("paused", paused);

        APIService service = retrofit.create(APIService.class);

        Call<APIService.MotionPauseResponse> pauseResponse =
                service.motionPause("Bearer ".concat(currentToken), streamId, pauseBody);

        pauseResponse.enqueue(new Callback<>() {
            @Override
            @EverythingIsNonNull
            public void onResponse(Call<APIService.MotionPauseResponse> call, Response<APIService.MotionPauseResponse> response) {
                Log.d("Motion Pause", "Motion paused successfully");
                if (callback != null) callback.onSuccess();
            }

            @Override
            @EverythingIsNonNull
            public void onFailure(Call<APIService.MotionPauseResponse> call, Throwable t) {
                Log.e("Motion Pause", "Failed to set motion pause state", t);
                if (callback != null) callback.onFailure("Failed to set motion pause state");
            }
        });
    }

    public interface RefreshTokenCallback {
        void onSuccess(String refreshToken, String token);
        void onFailure(String errorMessage);
    }

    public static void authenticate(String baseUrl, String refreshToken, String clientId, RefreshTokenCallback callback) {
        authenticate(baseUrl, refreshToken, clientId, callback, 1);
    }

    public static void authenticate(String baseUrl, String refreshToken, String clientId, RefreshTokenCallback callback, int attempt) {
        // One minute minimum rest between refreshes
        if (System.currentTimeMillis() - lastRefreshed < 60 * 1000) {
            Log.d("Refresh Token", "Token is still valid, skipping refresh");
            callback.onSuccess(refreshToken, HTTP.currentToken);
            return;
        }

        currentRefreshToken = sharedPreferences.getString("refreshToken", null);
        if (refreshToken == null) refreshToken = currentRefreshToken;

        assert baseUrl != null;
        assert clientId != null;
        assert refreshToken != null;
        String finalRefreshToken = refreshToken;

        if (refreshToken.equals(dontTryThisTokenAgain)) {
            Log.w("Refresh Token", "Failed to refresh token too many times in a row, skipping");
            callback.onFailure("Failed to refresh token too many times in a row");
            return;
        }

        Retrofit retrofit = new Retrofit.Builder()
                .baseUrl(baseUrl)
                .addConverterFactory(GsonConverterFactory.create())
                .build();

//        interface DeviceInfo {
//            userAgent: string
//            platform: string
//            vendor: string
//            language: string
//            timezone: string
//            screen: string
//            clientId: string
//        }
        JsonObject dummyDeviceInfoInner = new JsonObject();
        dummyDeviceInfoInner.addProperty("clientId", clientId);
        dummyDeviceInfoInner.addProperty("userAgent", MainActivity.userAgent);

        JsonObject dummyDeviceInfo = new JsonObject();
        dummyDeviceInfo.add("deviceInfo", dummyDeviceInfoInner);
        Log.d("Refresh Token", "Attempting to refresh token, client ID: " + dummyDeviceInfo.get("deviceInfo").getAsJsonObject().get("clientId").getAsString());

        APIService service = retrofit.create(APIService.class);

        Call<APIService.RefreshTokenResponse> refreshTokenResponse = service.refreshToken("_rt=".concat(refreshToken), dummyDeviceInfo);

        refreshTokenResponse.enqueue(new Callback<>() {
            @Override
            @EverythingIsNonNull
            public void onResponse(Call<APIService.RefreshTokenResponse> call, Response<APIService.RefreshTokenResponse> response) {
                APIService.RefreshTokenResponse body = response.body();

                ResponseBody errorBody = response.errorBody();
                if (errorBody != null) {

                    if (++refreshFailuresInARow >= 10) {
                        dontTryThisTokenAgain = finalRefreshToken;
                    }

                    try {
                        Log.e("Refresh Token", "Error refreshing token (attempt " + refreshFailuresInARow + "): " + errorBody.string());
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }

                    if (response.code() == 401 && attempt <= 3) {
                        Log.d("HTTP", "401 detected. Retrying in 5 seconds...");

                        // Wait 5 seconds before the next attempt
                        new Handler(Looper.getMainLooper()).postDelayed(() -> {
                            currentRefreshToken = sharedPreferences.getString("refreshToken", null);
                            HTTP.authenticate(baseUrl, HTTP.currentRefreshToken, clientId, callback, attempt + 1);
                        }, 5000);
                    } else {
                        callback.onFailure("Authentication failed due to expired token");
                    }

                    return;
                }

                assert body != null;
                if (body.refreshToken != null && body.token != null) {
                    refreshFailuresInARow = 0;
                    Log.d("Refresh Token", "Token refreshed successfully!");
                    HTTP.lastRefreshed = System.currentTimeMillis();
                    HTTP.currentRefreshToken = body.refreshToken;
                    HTTP.currentToken = body.token;
                    HTTP.currentStatusToken = body.statusToken;
                    if (sharedPreferences != null) {
                        SharedPreferences.Editor editor = sharedPreferences.edit();
                        editor.putString("refreshToken", body.refreshToken);
                        editor.putString("statusToken", body.statusToken);
                        editor.putString("token", body.token);
                        boolean success = editor.commit();
                        if (!success) {
                            Log.e("Refresh Token", "Failed to save refresh token");
                            dontTryThisTokenAgain = finalRefreshToken;
                            callback.onFailure("Failed to save refresh token to shared preferences");
                            return;
                        }
                    }
                    callback.onSuccess(body.refreshToken, body.token);
                } else {
                    if (++refreshFailuresInARow >= 10) {
                        dontTryThisTokenAgain = finalRefreshToken;
                    }
                    Log.e("Refresh Token", "Failed to refresh token (attempt " + refreshFailuresInARow + ")");
                    callback.onFailure("Refresh token or token is missing from the server response");
                }
            }

            @Override
            @EverythingIsNonNull
            public void onFailure(Call<APIService.RefreshTokenResponse> call, Throwable t) {
                if (++refreshFailuresInARow >= 10) {
                    dontTryThisTokenAgain = finalRefreshToken;
                }
                Log.e("Refresh Token", "Failed to refresh token (attempt " + refreshFailuresInARow + ")", t);
                callback.onFailure("Failed to refresh token");
            }
        });
    }

    /**
     * Checks if the JWT expires within a specific safety window.
     * @param jwtToken The raw JWT string
     * @param bufferInSeconds Minimum safety time left (e.g., 300 for 5 minutes)
     * @return true if the token is valid AND extends past the buffer window.
     */
    private static boolean isTokenValidAndNotExpiring(String jwtToken, long bufferInSeconds) {
        try {
            String[] parts = jwtToken.split("\\.");
            if (parts.length < 2) {
                return false; // Malformed JWT
            }

            // Decode the payload segment using URL-safe decoder
            byte[] decodedBytes = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                decodedBytes = Base64.getUrlDecoder().decode(parts[1]);
            }
            String payload = new String(decodedBytes, StandardCharsets.UTF_8);

            // Extract the "exp" claim via regex to avoid needing a heavy JSON library
            Pattern pattern = Pattern.compile("\"exp\"\\s*:\\s*(\\d+)");
            Matcher matcher = pattern.matcher(payload);

            if (matcher.find()) {
                long expirationTimeInSeconds = Long.parseLong(matcher.group(1));
                long currentTimeInSeconds = System.currentTimeMillis() / 1000;

                // Check if the token expires before the required safety window
                return expirationTimeInSeconds > (currentTimeInSeconds + bufferInSeconds);
            }
        } catch (Exception e) {
            // Treat corrupted data or padding failures as implicitly expired/invalid
            return false;
        }
        return false; // "exp" field wasn't found in the payload
    }
}
