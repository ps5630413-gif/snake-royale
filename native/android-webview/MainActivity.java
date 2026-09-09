package com.snakeroyale.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Snake Royale - minimal full screen WebView host.
 *
 * The whole game lives in app/src/main/assets/www/index.html.
 * The only native glue we need is:
 *   - a full screen, hardware accelerated WebView
 *   - DOM storage (the game persists progress with localStorage)
 *   - forwarding the hardware back button to the game as "backbutton"
 */
public class MainActivity extends Activity {

    private WebView webView;

    /** Entry point of the packaged web game. */
    private static final String GAME_URL = "file:///android_asset/www/index.html";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* --- full screen, no title bar ---------------------------------- */
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN);

        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.game_webview);

        /* --- WebView settings ------------------------------------------- */
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);        // REQUIRED: localStorage saves
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);             // the game is already DPI aware
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.NORMAL);

        // keep the canvas smooth on every device
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // expose a tiny native bridge (optional, handy for ads / exit)
        webView.addJavascriptInterface(new NativeBridge(), "AndroidBridge");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);   // chrome://inspect
        }

        /* --- keep navigation inside the game ---------------------------- */
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String url = uri.toString();
                // let the OS handle external links (store pages, https, tel...)
                if (url.startsWith("http://") || url.startsWith("https://")
                        || url.startsWith("market:") || url.startsWith("tel:")) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;                 // everything else stays in the app
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl(GAME_URL);
    }

    /* ------------------------------------------------------------------ *
     * Lifecycle: pause/resume/cleanup the WebView with the Activity
     * ------------------------------------------------------------------ */

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.pauseTimers();
            webView.evaluateJavascript("if(window.SR&&SR.App&&SR.App.game)SR.App.game.pause();", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.resumeTimers();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ *
     * Hardware back button -> "backbutton" event inside the page
     * (the game pauses / navigates instead of closing the app)
     * ------------------------------------------------------------------ */

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView.evaluateJavascript(
                    "(function(){var e=new Event('backbutton');document.dispatchEvent(e);return true;})()",
                    null);
            return true;                       // we handle it ourselves
        }
        return super.onKeyDown(keyCode, event);
    }

    /* ------------------------------------------------------------------ *
     * Tiny JavaScript bridge: window.AndroidBridge.*
     * ------------------------------------------------------------------ */
    private final class NativeBridge {

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                @Override public void run() { finishAffinity(); }
            });
        }

        @JavascriptInterface
        public String getPlatform() {
            return "android-webview";
        }
    }
}
