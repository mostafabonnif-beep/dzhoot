# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Keep line numbers for crash reporting
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep annotations
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions

# ---- Retrofit & OkHttp ----
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
-keepclassmembers,allowobfuscation class * {
    @retrofit2.http.* <methods>;
}
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations

# ---- Gson ----
-keep class com.google.gson.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
-keepattributes EnclosingMethod,InnerClasses
-keep class * extends com.google.gson.reflect.TypeToken

# ---- Room ----
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# ---- Hilt ----
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.ViewComponentManager$FragmentContextWrapper { *; }

# ---- Firebase ----
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# ---- Data model classes (API DTOs) ----
-keep class com.dzhoof.iptv.data.model.dto.** { *; }
-keep class com.dzhoof.iptv.data.source.remote.** { *; }

# ---- Compose ----
-dontwarn androidx.compose.**

# ---- ExoPlayer / Media3 ----
-dontwarn androidx.media3.**
-keep class androidx.media3.** { *; }

# ---- ZXing ----
-keep class com.google.zxing.** { *; }

# ---- Lottie ----
-dontwarn com.airbnb.lottie.**
-keep class com.airbnb.lottie.** { *; }

# ---- Kotlin Coroutines ----
-dontwarn kotlinx.coroutines.**
-keepclassmembers class kotlinx.coroutines.** { *; }

# ---- Amazon Appstore SDK (DRM) ----
-dontwarn com.amazon.device.**
-keep class com.amazon.device.drm.** { *; }
-keep class com.amazon.device.iap.** { *; }

# ---- General Android ----
-keep class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ===== Media3 (ExoPlayer) module registration =====
# R8 strips the HLS/DASH/SmoothStreaming modules because nothing references them
# directly: DefaultMediaSourceFactory discovers them via ServiceLoader using
# META-INF/services files. Without these rules the release APK loses HLS support
# entirely and every m3u8 stream fails with ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED.
-keep class androidx.media3.exoplayer.hls.** { *; }
-keep class androidx.media3.exoplayer.dash.** { *; }
-keep class androidx.media3.exoplayer.smoothstreaming.** { *; }
-keep class androidx.media3.exoplayer.rtsp.** { *; }

# Keep ServiceLoader-registered MediaSource factories constructible and discoverable.
-keep,allowobfuscation,allowshrinking,allowoptimization class * implements androidx.media3.exoplayer.source.MediaSourceFactory {
    <init>(...);
}
-keep,allowobfuscation,allowshrinking,allowoptimization class * extends androidx.media3.exoplayer.source.MediaSource$Factory {
    <init>(...);
}

# Attributes required by reflection/service lookup at runtime.
-keepattributes *Annotation*, InnerClasses, EnclosingMethod, Signature
