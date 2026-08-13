# CI Android failure — run 31704555004

Source: https://github.com/merci1994dz/dzhoot/actions/runs/31704555004

The `CI/android` job failed in `Run Android unit tests` after 2m39s. The available tail is dominated by Gradle/Kotlin worker stack frames and ends with `BUILD FAILED` and exit code 1. The precise compiler diagnostic is earlier in `/tmp/ci-android-failed.log`; it must be extracted by searching for `e:`, `error:`, `Unresolved reference`, or `Compilation error` before editing Android code.

## Local verification after the fix

After adding `import com.dzhoof.iptv.BuildConfig` to `SubscriptionRepositoryImpl.kt`, the local Gradle attempt no longer reached Kotlin compilation because this sandbox has no Android SDK configured: `SDK location not found`. CI remains the authoritative clean Android build environment; the original CI compiler error was `Unresolved reference: BuildConfig` at line 131.
