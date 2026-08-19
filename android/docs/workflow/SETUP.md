# DZ HOOF Android Setup

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Android Studio | Hedgehog (2023.1.1)+ | Includes Gradle, SDK Manager, AVD Manager |
| JDK | 17 | Required by `compileOptions` in build.gradle.kts |
| Android SDK | 34 (compileSdk) | Install via SDK Manager |
| Android SDK | 28+ (minSdk) | For running on device/emulator |
| Git | 2.x | For cloning the repo |
| Fire TV device **or** Android TV emulator | API 28+ | For testing |

## Clone & Build

```bash
# Clone the repository
git clone https://github.com/merci1994dz/dzhoot.git
cd dzhoot/android

# Build debug APK
./gradlew assembleDebug

# Build release APK
./gradlew assembleRelease

# Build dev variant (debug with .dev suffix)
./gradlew assembleDev
```

**APK output locations:**
- Debug: `app/build/outputs/apk/debug/app-debug.apk`
- Release: `app/build/outputs/apk/release/app-release.apk`
- Dev: `app/build/outputs/apk/dev/app-dev.apk`

### Build Variants

| Variant | App ID Suffix | Features |
|---------|--------------|----------|
| `debug` | — | Full logging, debug signing |
| `dev` | `.dev` | Same as debug, separate app ID for side-by-side install |
| `release` | — | Minify disabled (can be enabled), release signing |

## Configuration

### API Base URL

The URL is configured at build time in `app/build.gradle.kts`:

```bash
# Set the URL through a Gradle property instead of editing source:
./gradlew assembleDebug -PdzhoofApiUrl=https://tv.example.com/
# Or use: DZHOOF_API_URL=https://tv.example.com/ ./gradlew assembleDebug
```

Access in code via `BuildConfig.API_BASE_URL`.

### Firebase

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Add an Android app with package name `com.dzhoof.iptv`
3. Download `google-services.json` and place it in the `app/` directory
4. Firebase services used: Analytics, Realtime Database, Firestore

### Release Signing

Release signing uses environment variables:

```bash
export SIGNING_KEY_STORE=/path/to/keystore.jks
export SIGNING_STORE_PASSWORD=your_store_password
export SIGNING_KEY_ALIAS=your_key_alias
export SIGNING_KEY_PASSWORD=your_key_password
```

The release build requires these values for a signed APK. Do not place passwords or keystores in the repository; use GitHub Actions secrets or a local untracked environment.

## Running

### On Fire TV Device

```bash
# 1. Enable ADB on Fire TV:
#    Settings > My Fire TV > Developer Options > ADB Debugging: ON
#    Settings > My Fire TV > Developer Options > Apps from Unknown Sources: ON

# 2. Find Fire TV IP:
#    Settings > My Fire TV > About > Network

# 3. Connect via ADB
adb connect <FIRE_TV_IP>:5555

# 4. Verify connection
adb devices

# 5. Install
adb install app/build/outputs/apk/debug/app-debug.apk

# 6. Launch
adb shell am start -n com.dzhoof.iptv/.ComposeMainActivity
```

### On Android TV Emulator

1. In Android Studio: **Tools > Device Manager > Create Device**
2. Select a TV profile (e.g., "Android TV 1080p")
3. Select system image API 28 or higher
4. Start the emulator
5. Run the app from Android Studio or install via `adb install`

### On Android Studio

1. Open the project in Android Studio
2. Wait for Gradle sync to complete
3. Select your target device (Fire TV or emulator)
4. Click **Run** (Shift+F10)

## Testing

### Unit Tests

```bash
# Run all unit tests
./gradlew test

# Run tests for a specific class
./gradlew test --tests "com.dzhoof.iptv.data.repository.ChannelRepositoryImplTest"

# Run with verbose output
./gradlew test --info
```

**Test coverage includes:**
- Repository implementations (5 test files)
- Local data sources (5 test files)
- Remote data sources (2 test files)
- Use cases (6 test files)

Test files are located under `app/src/test/java/com/dzhoof/iptv/`.

### Manual Testing on Device

```bash
# View app logs
adb logcat | grep -i dzhoof

# View ExoPlayer logs
adb logcat | grep -i ExoPlayer

# Clear app data
adb shell pm clear com.dzhoof.iptv
```

**Test checklist:**
- [ ] App launches and shows Pairing screen on first launch
- [ ] Pairing flow completes (PIN display, polling, success)
- [ ] Channels load from server after pairing
- [ ] Channel playback works (HLS streams)
- [ ] D-pad navigation works across all screens
- [ ] Search with debounce works
- [ ] Favorites: add, remove, reorder
- [ ] Settings: theme, grid size, server URL
- [ ] Background channel sync triggers (check WorkManager)
- [ ] Health scanner shows online/offline status
- [ ] Thumbnails appear for online channels
- [ ] Playback position saves and resumes
- [ ] App update check and install

## Project Structure Overview

```
dzhoot/android/
├── app/
│   ├── build.gradle.kts          # App-level build config
│   ├── google-services.json      # Firebase config (not in git)
│   ├── schemas/                  # Room schema exports (versioned JSON)
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml
│       │   ├── java/com/dzhoof/iptv/
│       │   │   ├── api/          # Legacy API client
│       │   │   ├── data/         # Data layer (Room, Retrofit, repos)
│       │   │   ├── di/           # Hilt DI modules
│       │   │   ├── domain/       # Domain layer (models, use cases, repos)
│       │   │   ├── presentation/ # UI layer (Compose, ViewModels, nav)
│       │   │   ├── security/     # Encrypted preferences
│       │   │   ├── update/       # In-app update manager
│       │   │   └── worker/       # WorkManager sync
│       │   └── res/              # Resources (layouts, drawables, values)
│       └── test/                 # Unit tests
├── build.gradle.kts              # Project-level build config
├── gradle/
│   └── libs.versions.toml        # Version catalog
├── docs/                         # Documentation
└── README.md
```

## Common Issues

### Gradle Sync Failed

```bash
# Clean and rebuild
./gradlew clean
./gradlew assembleDebug

# Or in Android Studio:
# File > Invalidate Caches > Invalidate and Restart
```

### Missing google-services.json

Firebase plugins are applied only when a real `google-services.json` is present. For a local build, omit the file and the build remains reproducible without Firebase configuration. For a release build, add the reviewed file under `app/` or the appropriate variant directory and keep it out of Git.

### Room Schema Changes

When modifying Room entities:
1. Increment the version in `@Database(version = ...)` in `the current Room database class`
2. Either add a migration or keep `fallbackToDestructiveMigration()` for dev
3. Schema JSON is exported to `app/schemas/` (committed to git for version tracking)

### ADB Connection Refused

```bash
# Restart ADB server
adb kill-server
adb start-server

# Reconnect
adb connect <FIRE_TV_IP>:5555
```

### INSTALL_FAILED_UPDATE_INCOMPATIBLE

The signing key changed between installs:
```bash
# Uninstall first, then reinstall
adb uninstall com.dzhoof.iptv
adb install app-debug.apk
```

### Java Version Mismatch

The project requires JDK 17. In Android Studio:
- **File > Settings > Build > Build Tools > Gradle > Gradle JDK** → select JDK 17
- Or set `JAVA_HOME` environment variable to JDK 17 path
