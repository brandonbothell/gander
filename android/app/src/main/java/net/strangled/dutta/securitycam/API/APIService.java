package net.strangled.dutta.securitycam.API;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.gson.JsonObject;

import retrofit2.Call;
import retrofit2.http.Header;
import retrofit2.http.POST;
import retrofit2.http.Body;
import retrofit2.http.Path;

public interface APIService {
    @POST("/api/refresh-token")
    Call<RefreshTokenResponse> refreshToken(@Header("refresh-token") String refreshToken, @Body JsonObject deviceInfo);

    @POST("/api/subscribe")
    Call<APIResponse> fcmSubscribe(@Header("Authorization") String authorization, @Body JsonObject fcmSubscribeBody);

    @POST("/api/motion-pause/{streamId}")
    Call<MotionPauseResponse> motionPause(@Header("Authorization") String authorization, @Path("streamId") String streamId, @Body JsonObject motionPauseBody);

    class APIResponse {
        @Nullable public String error = null;
        @Nullable public Boolean success = null;
    }

    class RefreshTokenResponse extends APIResponse {
        @Nullable public String refreshToken = null;
        @Nullable public String token = null;
    }

    class MotionPauseResponse {
        @NonNull public Boolean paused = false;
    }
}
