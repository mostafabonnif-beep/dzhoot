plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.kapt)
    id("kotlin-parcelize")
    alias(libs.plugins.hilt)
    id("io.sentry.android.gradle")
    id("jacoco")
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
            "1.0.29"
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
            ?: error("Missing Backend URL. Build with -PdzhoofApiUrl=https://your-server/ or set DZHOOF_API_URL.")
        require(configuredApiUrl.startsWith("https://")) {
            "DZHOOF_API_URL / dzhoofApiUrl must use HTTPS (got: $configuredApiUrl)"
        }
        // Firebase is optional for local/debug builds because the real
        // google-services.json is intentionally supplied only by CI/release.
        buildConfigField("String", "API_BASE_URL", "\"$configuredApiUrl\"")
        buildConfigField("Boolean", "FIREBASE_ENABLED", googleServicesAvailable.toString())
        manifestPlaceholders["sentryDsn"] = System.getenv("SENTRY_DSN") ?: ""
        manifestPlaceholders["sentryEnvironment"] = "debug"
    }

    flavorDimensions += "environment"
    productFlavors {
        create("official") {
            dimension = "environment"
            buildConfigField("String", "RELEASE_CHANNEL", "\"official\"")
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("String", "RELEASE_CHANNEL", "\"staging\"")
        }
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
            // R8/minify is DISABLED for the production build. Media3 1.4.1 discovers
            // the HLS/DASH module factories via Class.forName("...HlsMediaSource$Factory")
            // (DelegateFactoryLoader), which R8 cannot trace: the release APK silently
            // lost HLS support and every m3u8 stream failed with
            // ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED (no segment fetches ever started).
            // Until R8 keeps those classes by name, ship the unshrunk dex — playback
            // reliability is worth more than a smaller APK.
            isMinifyEnabled = false
            isShrinkResources = false
            manifestPlaceholders["sentryEnvironment"] = "production"
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
        create("dev") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
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

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
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

val sentryAuthToken = System.getenv("SENTRY_AUTH_TOKEN")?.trim().orEmpty()

sentry {
    // Gradle-plugin telemetry probes sentry-cli at task-graph time. Disable this
    // non-essential build telemetry so local/CI tests do not depend on executing
    // the downloaded CLI; the in-app Sentry SDK and authenticated upload tasks remain intact.
    telemetry = false
    includeSourceContext = true
    org = "dzhoof"
    projectName = "dzhoof"
    authToken = sentryAuthToken
}

// Source-map upload is optional. Release APK packaging must remain reproducible
// when a deployment environment has no Sentry token; CI/production still uploads
// the files automatically whenever SENTRY_AUTH_TOKEN is configured.
tasks.configureEach {
    if (name.startsWith("uploadSentry") || name.startsWith("sentryBundleSources")) {
        onlyIf { sentryAuthToken.isNotBlank() }
    }
}

tasks.withType<Test> {
    configure<JacocoTaskExtension> {
        isIncludeNoLocationClasses = true
        excludes = listOf("jdk.internal.*")
    }
}

tasks.register<JacocoReport>("jacocoTestReport") {
    // Product flavors create tasks such as testStagingDevUnitTest; a plain
    // testDebugUnitTest task does not exist in this project.
    dependsOn(tasks.matching { it.name.startsWith("test") && it.name.endsWith("UnitTest") })

    reports {
        xml.required.set(true)
        html.required.set(true)
    }

    val fileFilter = listOf(
        "**/R.class", "**/R\$*.class", "**/BuildConfig.*",
        "**/Manifest*.*", "**/*Test*.*", "android/**/*.*",
        // Hilt/DI generated code
        "**/*_Hilt*.*", "**/Hilt_*.*", "**/*_Factory.*",
        "**/*_MembersInjector.*", "**/Dagger*.*",
        "**/di/**", "**/hilt_aggregated_deps/**", "**/dagger/**",
        // Compose UI — requires instrumented tests, not unit tests
        "**/presentation/ui/screens/**",
        "**/presentation/ui/components/**",
        "**/presentation/ui/theme/**",
        "**/presentation/ui/animation/**",
        "**/presentation/ui/utils/**",
        "**/presentation/navigation/**",
        // Android framework classes not testable in unit tests
        "**/*Activity*.*",
        "**/*Application*.*",
        "**/*Service*.*",
        "**/*Receiver*.*",
        "**/worker/**",
        "**/ChannelManager*.*",
        "**/update/**",
        "**/security/**",
        // Room-generated code — requires instrumented tests, not unit tests
        "**/*Dao_Impl*.*",
        "**/*Database_Impl*.*",
        // Hardware-dependent services — not testable in JVM unit tests
        "**/ChannelThumbnailExtractor*.*",
        "**/drm/**"
    )
    classDirectories.setFrom(
        fileTree("${layout.buildDirectory.get()}/intermediates/classes/debug/transformDebugClassesWithAsm/dirs") {
            exclude(fileFilter)
        }
    )
    sourceDirectories.setFrom(files("${projectDir}/src/main/kotlin", "${projectDir}/src/main/java"))
    executionData.setFrom(fileTree(layout.buildDirectory.get()) {
        include("jacoco/testDebugUnitTest.exec")
    })
}
