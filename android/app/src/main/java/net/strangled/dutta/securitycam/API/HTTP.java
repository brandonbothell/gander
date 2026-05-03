package net.strangled.dutta.securitycam.API;

import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.Nullable;

import com.google.gson.JsonObject;

import net.strangled.dutta.securitycam.MainActivity;

import java.io.IOException;

import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;
import retrofit2.internal.EverythingIsNonNull;

public class HTTP {
    private static int lastRefreshed = 0;
    private static String currentRefreshToken = null;
    private static String currentToken = null;
    public static SharedPreferences sharedPreferences = null;

    public interface SubscribeCallback {
        void onSuccess();
        void onFailure(String errorMessage);
    }

    public interface RefreshTokenCallback {
        void onSuccess(String refreshToken, String token);
        void onFailure(String errorMessage);
    }

    public static void authenticate(String baseUrl, String refreshToken, String clientId, RefreshTokenCallback callback) {
            // One minute minimum rest between refreshes
            if (System.currentTimeMillis() - lastRefreshed < 60 * 1000) {
                Log.d("Refresh Token", "Token is still valid, skipping refresh");
                callback.onSuccess(refreshToken, HTTP.currentToken);
                return;
            }

            if (refreshToken == null) refreshToken = currentRefreshToken;

            assert baseUrl != null;
            assert clientId != null;
            assert refreshToken != null;

            Retrofit retrofit = new Retrofit.Builder()
                    .baseUrl(baseUrl)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build();

//            interface DeviceInfo {
//                userAgent: string
//                platform: string
//                vendor: string
//                language: string
//                timezone: string
//                screen: string
//                clientId: string
//            }
            JsonObject dummyDeviceInfoInner = new JsonObject();
            dummyDeviceInfoInner.addProperty("clientId", clientId);
            dummyDeviceInfoInner.addProperty("userAgent", MainActivity.userAgent);

            JsonObject dummyDeviceInfo = new JsonObject();
            dummyDeviceInfo.add("deviceInfo", dummyDeviceInfoInner);

            APIService service = retrofit.create(APIService.class);

            Call<APIService.RefreshTokenResponse> refreshTokenResponse = service.refreshToken("_rt=".concat(refreshToken), dummyDeviceInfo);

            refreshTokenResponse.enqueue(new Callback<>() {
                @Override
                @EverythingIsNonNull
                public void onResponse(Call<APIService.RefreshTokenResponse> call, Response<APIService.RefreshTokenResponse> response) {
                    APIService.RefreshTokenResponse body = response.body();

                    ResponseBody errorBody = response.errorBody();
                    if (errorBody != null) {
                        try {
                            Log.e("Refresh Token", "Error refreshing token: " + errorBody.string());
                        } catch (IOException e) {
                            throw new RuntimeException(e);
                        }
                        return;
                    }

                    assert body != null;
                    if (body.refreshToken != null && body.token != null) {
                        Log.d("Refresh Token", "Token refreshed successfully!");
                        HTTP.lastRefreshed = (int) System.currentTimeMillis();
                        HTTP.currentRefreshToken = body.refreshToken;
                        HTTP.currentToken = body.token;
                        if (sharedPreferences != null) {
                            SharedPreferences.Editor editor = sharedPreferences.edit();
                            editor.putString("refreshToken", body.refreshToken);
                            boolean success = editor.commit();
                            if (!success) {
                                Log.e("Refresh Token", "Failed to save refresh token");
                                callback.onFailure("Failed to save refresh token to shared preferences");
                                return;
                            }
                        }
                        callback.onSuccess(body.refreshToken, body.token);
                    } else {
                        Log.e("Refresh Token", "Token refresh failed!");
                        callback.onFailure("Refresh token or token is missing from the server response");
                    }
                }

                @Override
                @EverythingIsNonNull
                public void onFailure(Call<APIService.RefreshTokenResponse> call, Throwable t) {
                    Log.e("Refresh Token", "Failed to refresh token", t);
                    callback.onFailure("Failed to refresh token");
                }
            });
    }

    public static void subscribeToSocket(String baseUrl, String clientId, @Nullable SubscribeCallback callback) {
        RefreshTokenCallback refreshTokenCallback = new RefreshTokenCallback() {

            @Override
            public void onSuccess(String refreshToken, String token) {
                assert baseUrl != null;
                assert clientId != null;
                assert token != null;

                Retrofit retrofit = new Retrofit.Builder()
                        .baseUrl(baseUrl)
                        .addConverterFactory(GsonConverterFactory.create())
                        .build();

                JsonObject subscribeBody = new JsonObject();
                subscribeBody.addProperty("clientId", clientId);

                APIService service = retrofit.create(APIService.class);

                Call<APIService.APIResponse> subscribeResponse = service.fcmSubscribe("Bearer ".concat(token), subscribeBody);

                subscribeResponse.enqueue(new Callback<>() {
                    @Override
                    @EverythingIsNonNull
                    public void onResponse(Call<APIService.APIResponse> call, Response<APIService.APIResponse> response) {
                        APIService.APIResponse body = response.body();

                        ResponseBody errorBody = response.errorBody();
                        if (errorBody != null) {
                            try {
                                Log.e("Socket Subscribe", "Error subscribing to socket: " + errorBody.string());
                            } catch (IOException e) {
                                throw new RuntimeException(e);
                            }
                            return;
                        }

                        assert body != null;
                        if (Boolean.TRUE.equals(body.success)) {
                            Log.d("Socket Subscribe", "Socket subscribed successfully!");
                            if (callback != null) callback.onSuccess();
                        } else {
                            Log.e("Socket Subscribe", "Socket subscription failed! Error: " + body.error);
                            if (callback != null) callback.onFailure(body.error);
                        }
                    }

                    @Override
                    @EverythingIsNonNull
                    public void onFailure(Call<APIService.APIResponse> call, Throwable t) {
                        Log.e("Socket Subscribe", "Failed to subscribe to socket", t);
                        if (callback != null) callback.onFailure("Failed to subscribe to socket");
                    }
                });
            }

            @Override
            public void onFailure(String errorMessage) {
                Log.e("Socket Subscribe", "Failed to refresh token: " + errorMessage);
            }
        };

        if (currentToken == null || (int) System.currentTimeMillis() - lastRefreshed > 60 * 1000) {
            HTTP.authenticate(baseUrl, currentRefreshToken, clientId, refreshTokenCallback);
        } else {
            refreshTokenCallback.onSuccess(currentRefreshToken, currentToken);
        }
    }

    public static void subscribeToFCM(String baseUrl, String clientId, String fcmToken, @Nullable SubscribeCallback callback) {
        RefreshTokenCallback refreshTokenCallback = new RefreshTokenCallback() {

            @Override
            public void onSuccess(String refreshToken, String token) {
                assert baseUrl != null;
                assert token != null;

                Retrofit retrofit = new Retrofit.Builder()
                        .baseUrl(baseUrl)
                        .addConverterFactory(GsonConverterFactory.create())
                        .build();

                JsonObject subscribeBody = new JsonObject();
                subscribeBody.addProperty("fcmToken", fcmToken);

                APIService service = retrofit.create(APIService.class);

                Call<APIService.APIResponse> subscribeResponse = service.fcmSubscribe("Bearer ".concat(token), subscribeBody);

                subscribeResponse.enqueue(new Callback<>() {
                    @Override
                    @EverythingIsNonNull
                    public void onResponse(Call<APIService.APIResponse> call, Response<APIService.APIResponse> response) {
                        APIService.APIResponse body = response.body();

                        ResponseBody errorBody = response.errorBody();
                        if (errorBody != null) {
                            try {
                                Log.e("FCM Subscribe", "Error subscribing to FCM: " + errorBody.string());
                            } catch (IOException e) {
                                throw new RuntimeException(e);
                            }
                            return;
                        }

                        assert body != null;
                        if (Boolean.TRUE.equals(body.success)) {
                            Log.d("FCM Subscribe", "FCM subscribed successfully!");
                            if (callback != null) callback.onSuccess();
                        } else {
                            Log.e("FCM Subscribe", "FCM subscription failed! Error: " + body.error);
                            if (callback != null) callback.onFailure(body.error);
                        }
                    }

                    @Override
                    @EverythingIsNonNull
                    public void onFailure(Call<APIService.APIResponse> call, Throwable t) {
                        Log.e("FCM Subscribe", "Failed to subscribe to FCM", t);
                        if (callback != null) callback.onFailure("Failed to subscribe to FCM");
                    }
                });
            }

            @Override
            public void onFailure(String errorMessage) {
                Log.e("FCM Subscribe", "Failed to refresh token: " + errorMessage);
            }
        };

        if (currentToken == null || (int) System.currentTimeMillis() - lastRefreshed > 60 * 1000) {
            HTTP.authenticate(baseUrl, currentRefreshToken, clientId, refreshTokenCallback);
        } else {
            refreshTokenCallback.onSuccess(currentRefreshToken, currentToken);
        }
    }

    public static void unsubscribeFromSocket(String baseUrl, String clientId, @Nullable SubscribeCallback callback) {
        RefreshTokenCallback refreshTokenCallback = new RefreshTokenCallback() {
            @Override
            public void onSuccess(String refreshToken, String token) {
                assert baseUrl != null;
                assert clientId != null;
                assert token != null;

                Retrofit retrofit = new Retrofit.Builder()
                        .baseUrl(baseUrl)
                        .addConverterFactory(GsonConverterFactory.create())
                        .build();

                JsonObject unsubscribeBody = new JsonObject();
                unsubscribeBody.addProperty("clientId", true);

                APIService service = retrofit.create(APIService.class);

                Call<APIService.APIResponse> unsubscribeResponse = service.fcmUnsubscribe("Bearer ".concat(currentToken), unsubscribeBody);

                unsubscribeResponse.enqueue(new Callback<>() {
                    @Override
                    @EverythingIsNonNull
                    public void onResponse(Call<APIService.APIResponse> call, Response<APIService.APIResponse> response) {
                        APIService.APIResponse body = response.body();

                        ResponseBody errorBody = response.errorBody();
                        if (errorBody != null) {
                            try {
                                Log.e("Socket Unsubscribe", "Error unsubscribing from socket: " + errorBody.string());
                            } catch (IOException e) {
                                throw new RuntimeException(e);
                            }
                            return;
                        }

                        assert body != null;
                        if (Boolean.TRUE.equals(body.success)) {
                            Log.d("Socket Unsubscribe", "Socket unsubscribed successfully!");
                            if (callback != null) callback.onSuccess();
                        } else {
                            Log.e("Socket Unsubscribe", "Socket unsubscription failed! Error: " + body.error);
                            if (callback != null) callback.onFailure(body.error);
                        }
                    }

                    @Override
                    @EverythingIsNonNull
                    public void onFailure(Call<APIService.APIResponse> call, Throwable t) {
                        Log.e("Socket Unsubscribe", "Failed to unsubscribe from socket", t);
                        if (callback != null) callback.onFailure("Failed to unsubscribe from socket");
                    }
                });
            }

            @Override
            public void onFailure(String errorMessage) {
                Log.e("Socket Unsubscribe", "Failed to refresh token: " + errorMessage);
            }
        };

        if (currentToken == null || (int) System.currentTimeMillis() - lastRefreshed > 60 * 1000) {
            HTTP.authenticate(baseUrl, currentRefreshToken, clientId, refreshTokenCallback);
        } else {
            refreshTokenCallback.onSuccess(currentRefreshToken, currentToken);
        }
    }

    public static void setMotionPaused(String baseUrl, String clientId, String streamId,
                                       boolean paused, @Nullable SubscribeCallback callback) {
        RefreshTokenCallback refreshTokenCallback = new RefreshTokenCallback() {

            @Override
            public void onSuccess(String refreshToken, String token) {
                assert baseUrl != null;
                assert token != null;

                Retrofit retrofit = new Retrofit.Builder()
                        .baseUrl(baseUrl)
                        .addConverterFactory(GsonConverterFactory.create())
                        .build();

                JsonObject pauseBody = new JsonObject();
                pauseBody.addProperty("paused", paused);

                APIService service = retrofit.create(APIService.class);

                Call<APIService.MotionPauseResponse> pauseResponse =
                        service.motionPause("Bearer ".concat(token), streamId, pauseBody);

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

            @Override
            public void onFailure(String errorMessage) {
                Log.e("Motion Pause", "Failed to refresh token: " + errorMessage);
            }
        };

        if (currentToken == null || (int) System.currentTimeMillis() - lastRefreshed > 60 * 1000) {
            HTTP.authenticate(baseUrl, currentRefreshToken, clientId, refreshTokenCallback);
        } else {
            refreshTokenCallback.onSuccess(currentRefreshToken, currentToken);
        }
    }

    public static void setCurrentRefreshToken(String refreshToken) {
        currentRefreshToken = refreshToken;
        lastRefreshed = (int) System.currentTimeMillis();
    }
}
