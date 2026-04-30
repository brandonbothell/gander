package net.strangled.dutta.securitycam;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.core.app.NotificationManagerCompat;
import com.google.gson.JsonObject;

import net.strangled.dutta.securitycam.API.APIService;

import java.io.IOException;
import java.util.Objects;
import java.util.Set;

import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;
import retrofit2.internal.EverythingIsNonNull;

public class PauseDetectionNotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        StringBuilder allKeys = new StringBuilder();
        Set<String> keys = Objects.requireNonNull(intent.getExtras()).keySet();
        for (String key : keys) {
            allKeys.append(key).append(" ");
        }
        Log.d("NotificationActionReceiver", "Notification action received, intent extras: " + allKeys);

        String cameraId = intent.getStringExtra(ctx.getPackageName() + ".cameraId");
        String baseUrl = intent.getStringExtra(ctx.getPackageName() + ".baseUrl");
        String clientId = intent.getStringExtra(ctx.getPackageName() + ".clientId");
        SharedPreferences sharedPref = ctx.getSharedPreferences("CapacitorStorage", Activity.MODE_PRIVATE);
        String refreshToken = sharedPref.getString("refreshToken", null);
        int notificationId = intent.getIntExtra(ctx.getPackageName() + ".notificationId", 0);

        // 1. Dismiss the notification immediately
        NotificationManagerCompat.from(ctx).cancel(notificationId);

        // 2. Execute Retrofit Call
        assert baseUrl != null;
        assert clientId != null;
        Retrofit retrofit = new Retrofit.Builder()
                .baseUrl(baseUrl)
                .addConverterFactory(GsonConverterFactory.create())
                .build();

        APIService service = retrofit.create(APIService.class);
        JsonObject motionPauseBody = new JsonObject();
        motionPauseBody.addProperty("paused", true);

        JsonObject dummyDeviceInfoInner = new JsonObject();
        dummyDeviceInfoInner.addProperty("clientId", clientId);
        dummyDeviceInfoInner.addProperty("userAgent", MainActivity.userAgent);

        JsonObject dummyDeviceInfo = new JsonObject();
        dummyDeviceInfo.add("deviceInfo", dummyDeviceInfoInner);

        Log.d("NotificationActionReceiver", "Device info: " + dummyDeviceInfo);

        service.refreshToken(refreshToken, dummyDeviceInfo).enqueue(new Callback<>() {
            @Override
            @EverythingIsNonNull
            public void onResponse(Call<APIService.RefreshTokenResponse> call, Response<APIService.RefreshTokenResponse> response) {
                Log.d("NotificationActionReceiver", "Token refreshed successfully!");
                APIService.RefreshTokenResponse body = response.body();

                ResponseBody errorBody = response.errorBody();
                if (errorBody != null) {
                    try {
                        Log.e("NotificationActionReceiver", "Error refreshing token: " + errorBody.string());
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                    return;
                }

                assert body != null;
                if (body.error != null) {
                    Log.e("NotificationActionReceiver", "Error refreshing token: " + body.error);
                    return;
                }

                if (body.refreshToken != null) {
                    SharedPreferences.Editor editor = sharedPref.edit();
                    editor.putString("refreshToken", body.refreshToken);
                    editor.apply();
                }

                if (body.token != null) {
                    service.motionPause("Bearer ".concat(body.token), cameraId, motionPauseBody).enqueue(new Callback<>() {
                        @Override
                        @EverythingIsNonNull
                        public void onResponse(Call<APIService.MotionPauseResponse> call, Response<APIService.MotionPauseResponse> response) {
                            Log.d("NotificationActionReceiver", "Motion paused successfully");
                        }

                        @Override
                        @EverythingIsNonNull
                        public void onFailure(Call<APIService.MotionPauseResponse> call, Throwable t) {
                            Log.e("NotificationActionReceiver", "Failed to pause motion", t);
                        }
                    });
                }
            }

            @Override
            @EverythingIsNonNull
            public void onFailure(Call<APIService.RefreshTokenResponse> call, Throwable t) {
                Log.e("FCMService", "Failed to refresh token", t);
            }
        });
    }
}
