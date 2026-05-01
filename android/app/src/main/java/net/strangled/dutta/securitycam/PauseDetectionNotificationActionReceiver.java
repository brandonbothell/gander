package net.strangled.dutta.securitycam;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.gson.JsonObject;

import net.strangled.dutta.securitycam.API.APIService;

import java.io.IOException;
import java.util.Objects;
import java.util.Optional;
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

        // 1. Edit notification action to "Unpause Detection"
//        NotificationManagerCompat.from(ctx).cancel(notificationId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Optional<StatusBarNotification> notificationOptional = NotificationManagerCompat.from(ctx)
                    .getActiveNotifications().stream()
                    .filter(n -> n.getId() == notificationId)
                    .findFirst();
            if (notificationOptional.isPresent()) {
                Intent startIntent = new Intent(ctx, StartDetectionNotificationActionReceiver.class)
                    .putExtra(ctx.getPackageName() + ".cameraId", cameraId)
                    .putExtra(ctx.getPackageName() + ".baseUrl", baseUrl)
                    .putExtra(ctx.getPackageName() + ".notificationId", notificationId)
                    .putExtra(ctx.getPackageName() + ".clientId", clientId);

                StatusBarNotification notification = notificationOptional.get();
                Notification notificationObj = notification.getNotification();
                notificationObj.actions[0].title = "Start Detection";
                notificationObj.actions[0].actionIntent = PendingIntent.getBroadcast(
                        ctx,
                        notificationId + 1, // Unique request code
                        startIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

                if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    // TODO: Consider calling
                    //    ActivityCompat#requestPermissions
                    // here to request the missing permissions, and then overriding
                    //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
                    //                                          int[] grantResults)
                    // to handle the case where the user grants the permission. See the documentation
                    // for ActivityCompat#requestPermissions for more details.
                    return;
                }
                NotificationManagerCompat.from(ctx).notify(notificationId, notificationObj);
            }
        } else {
            NotificationManagerCompat.from(ctx).cancel(notificationId);
        }

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

        assert refreshToken != null;
        service.refreshToken("_rt=".concat(refreshToken), dummyDeviceInfo).enqueue(new Callback<>() {
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
