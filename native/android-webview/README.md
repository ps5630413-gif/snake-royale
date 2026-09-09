# Bare Android WebView template (no Capacitor, no Cordova)

Use this template if you want a *plain* Android Studio project that simply
hosts the web game inside a full-screen `WebView`. It is the lightest possible
APK (no extra runtime, ~1 MB) and a good way to understand what Capacitor does
for you under the hood.

> For most projects the **Capacitor** path in the main [README](../../README.md)
> is recommended: it handles plugins (AdMob), splash screens and permissions.

## How to use it

1. **Android Studio → New Project → Empty Views Activity**
   - Language: **Java** (or Kotlin - the code below is Java)
   - Minimum SDK: **API 22 (Android 5.1)**
   - Package name: `com.snakeroyale.app`

2. **Copy the web assets** into the new project:

   ```
   <your-project>/app/src/main/assets/www/     <- everything inside www/
   ```

   ```bash
   mkdir -p app/src/main/assets
   cp -r ../www app/src/main/assets/www
   ```

3. **Replace the generated files** with the ones in this folder:

   | This file                       | Destination in the Android project          |
   | ------------------------------- | ------------------------------------------- |
   | `MainActivity.java`             | `app/src/main/java/com/snakeroyale/app/`    |
   | `activity_main.xml`             | `app/src/main/res/layout/`                  |
   | `AndroidManifest.xml`           | `app/src/main/`                             |
   | `build.gradle`                  | `app/` (module level)                       |
   | `themes.xml`                    | `app/src/main/res/values/`                  |

4. **Sync Gradle**, then `Run ▶` on a device or emulator.

5. **Build the APK**: `Build → Build Bundle(s) / APK(s) → Build APK(s)`,
   or `Build → Generate Signed Bundle / APK` for a release build.

## What the template configures

- Fullscreen, hardware-accelerated `WebView` with JavaScript + DOM storage
  (DOM storage is required: the game saves progress to `localStorage`).
- Orientation locked to portrait, no action bar, dark background.
- Back button forwarded to the game as the `backbutton` event
  (the game listens for it and pauses / navigates back instead of exiting).
- App paused/resumed together with the WebView (`onPause` / `onResume`).
- External links (e.g. a store page) open in the browser instead of the WebView;
  everything else stays inside the app.

## Going further

- **AdMob**: a bare WebView cannot show native ads. Either add
  `@capacitor-community/admob` (Capacitor) / `cordova-plugin-admob-free`
  (Cordova), or use the Google Mobile Ads SDK directly from Java and expose a
  JavaScript interface with `addJavascriptInterface`.
- **Better asset origin**: `file://` works, but for production consider
  `androidx.webkit.WebViewAssetLoader`, which serves the assets from
  `https://appassets.androidplatform.net/` and gives the page a real HTTPS
  origin (more reliable `localStorage`, safer cookies).
