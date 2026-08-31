plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.kapt)
    id("kotlin-parcelize")
    alias(libs.plugins.hilt)
}

// Firebase plugins require a real google-services.json, which is intentionally
// not committed. Keep local debug/unit builds reproducible without secrets;
// CI/release builds enable Firebase automatically when the file is provided.
val googleServicesAvailable = listOf(
    "google-services.json",
    "src/debug/google-services.json",
    "src/release/google-services.json",
).any { file(it).exists() }

if (googleServicesAvailable) {
    apply(plugin = "com.google.gms.google-services")
    apply(plugin = "com.google.firebase.crashlytics")
    apply(plugin = "com.google.firebase.firebase-perf")
}

android {
    namespace = "com.dzhoof.iptv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dzhoof.iptv"
        minSdk = 28
        targetSdk = 34
        // versionCode is DERIVED from versionName (major*10000 + minor*100 + patch)
        // so release builds always advertise the code the server expects.
        // It was previously hardcoded (10010): a v1.0.11 APK still advertised
        // 10010, so after installing the update the app kept re-prompting
        // (server latest 10011 > installed 10010) — an infinite update loop.
        val buildVersionName = if (project.hasProperty("versionName")) {
            project.property("versionName") as String
        } else {
            "1.0.40"
        }
        val buildVersionParts = buildVersionName
            .trim()
            .removePrefix("v")
            .split("-")[0] // drop suffixes like "-rc.1" / "-staging"
            .split(".")
            .map { it.toIntOrNull() ?: 0 }
        versionCode = buildVersionParts.getOrElse(0) { 0 } * 10000 +
                buildVersionParts.getOrElse(1) { 0 } * 100 +
                buildVersionParts.getOrElse(2) { 0 }
        versionName = buildVersionName
        
        // API Base URL configuration — overridable at build time via the
        // `dzhoofApiUrl` Gradle property or the DZHOOF_API_URL env var so real
        // APKs can point at a real server without editing source. HTTPS required.
        val configuredApiUrl = providers.gradleProperty("dzhoofApiUrl")
            .orElse(providers.environmentVariable("DZHOOF_API_URL"))
            .orNull
            ?.trim()
            ?.let { if (it.endsWith("/")) it else "$it/" }
            ?: "https://ais-dev-n3liw5qxqy25yb2x2vidnb-118395858805.europe-west1.run.app/"
        require(configuredApiUrl.startsWith("https://")) {
            "DZHOOF_API_URL / dzhoofApiUrl must use HTTPS (got: $configuredApiUrl)"
        }
        // Firebase is optional for local/debug builds because the real
        // google-services.json is intentionally supplied only by CI/release.
        buildConfigField("String", "API_BASE_URL", "\"$configuredApiUrl\"")
        buildConfigField("String", "RELEASE_CHANNEL", "\"official\"")
        buildConfigField("Boolean", "FIREBASE_ENABLED", googleServicesAvailable.toString())
        manifestPlaceholders["sentryDsn"] = System.getenv("SENTRY_DSN") ?: ""
        manifestPlaceholders["sentryEnvironment"] = "debug"
    }

    signingConfigs {
        create("release") {
            val signingKeyStore = System.getenv("SIGNING_KEY_STORE")
            if (signingKeyStore != null) {
                storeFile = file(signingKeyStore)
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    // Room schema export configuration
    kapt {
        correctErrorTypes = true
        arguments {
            arg("room.schemaLocation", "$projectDir/schemas")
        }
    }

    buildTypes {
        release {
            // R8 is enabled for production. The project-specific rules below keep
            // Media3 HLS/DASH service-loaded factories and the reflection-heavy SDKs
            // required by the player. Release builds must be tested with a real HLS
            // manifest before publication.
            isMinifyEnabled = true
            isShrinkResources = true
            manifestPlaceholders["sentryEnvironment"] = "production"
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    // AndroidX Leanback (updated)
    implementation(libs.androidx.leanback)
    implementation(libs.androidx.appcompat)

    // Coil for modern image loading
    implementation(libs.coil)
    implementation(libs.coil.compose)

    // Firebase - using BoM for version management
    implementation(platform("com.google.firebase:firebase-bom:33.1.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.firebase:firebase-crashlytics")
    implementation("com.google.firebase:firebase-perf")
    implementation("com.google.firebase:firebase-database")
    implementation("com.google.firebase:firebase-firestore")

    // TV Provider support
    implementation("androidx.tvprovider:tvprovider:1.1.0")

    // Media3 ExoPlayer (updated)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.media3.exoplayer.dash)
    implementation(libs.androidx.media3.ui)
    implementation(libs.androidx.media3.datasource.okhttp)

    // Jetpack Compose for TV
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.tv.foundation)
    implementation(libs.androidx.tv.material)
    implementation(libs.androidx.activity.compose)

    // Hilt Dependency Injection
    implementation(libs.hilt.android)
    kapt(libs.hilt.compiler)
    implementation(libs.hilt.work)
    kapt(libs.hilt.work.compiler)
    implementation(libs.hilt.navigation.compose)

    // Security
    implementation(libs.security.crypto)

    // Material Icons Extended
    implementation(libs.compose.material.icons.extended)

    // Room Database
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    kapt(libs.androidx.room.compiler)

    // Retrofit & OkHttp
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.gson)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging.interceptor)

    // Kotlin Coroutines
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)

    // WorkManager
    implementation(libs.androidx.work.runtime.ktx)

    // Sentry
    implementation(libs.sentry.android)

    // Navigation Component (Compose only)
    implementation(libs.androidx.navigation.compose)

    // Lifecycle (updated)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    // Amazon Appstore SDK (DRM license verification)
    implementation("com.amazon.device:amazon-appstore-sdk:3.0.5")

    // QR Code generation
    implementation("com.google.zxing:core:3.5.3")

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)
}

