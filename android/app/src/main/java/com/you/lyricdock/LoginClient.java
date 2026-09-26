package com.you.lyricdock;

import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;

import org.json.JSONObject;

// Spotify login (Authorization Code + PKCE) shown in a second WebView over the dock. Spotify redirects to
// http://127.0.0.1:8976/callback?code=...; that navigation is intercepted here (nothing listens on the port)
// and handed to the page as {"type":"auth","url":...}. Close button = cancelled ({"url":""}).
// Also the Runnable that opens/closes the overlay on the UI thread. Top-level: the Gradle-free build can't
// dex inner/anonymous classes.
class LoginClient extends WebViewClient implements Runnable, View.OnClickListener {
    static final String REDIRECT = "http://127.0.0.1:8976/callback";

    private final MainActivity app;
    private final String url;
    private FrameLayout overlay;
    private boolean done;

    LoginClient(MainActivity app, String url) { this.app = app; this.url = url; }

    @Override public void run() {
        if (overlay != null) { ((ViewGroup) overlay.getParent()).removeView(overlay); overlay = null; return; }
        if (done) return;
        overlay = new FrameLayout(app);
        overlay.setBackgroundColor(Color.BLACK);
        WebView w = new WebView(app);
        w.getSettings().setJavaScriptEnabled(true);
        w.getSettings().setDomStorageEnabled(true);
        w.setWebViewClient(this);
        overlay.addView(w, new FrameLayout.LayoutParams(-1, -1));
        Button close = new Button(app);
        close.setText("✕");
        close.setOnClickListener(this);
        overlay.addView(close, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END));
        app.root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        w.loadUrl(url);
    }

    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        String u = r.getUrl().toString();
        if (!u.startsWith(REDIRECT)) return false;
        finish(u);
        return true;
    }

    @Override public void onClick(View v) { finish(""); }

    private void finish(String result) {
        if (done) return;
        done = true;
        try { app.deliver(new JSONObject().put("type", "auth").put("url", result).toString()); } catch (Exception ignored) {}
        app.runOnUiThread(this); // removes the overlay
    }
}
