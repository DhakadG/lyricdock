package com.you.lyricdock;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.concurrent.ConcurrentLinkedQueue;

// Also the UI-thread Runnable that hands queued bridge messages to the page (no inner classes - see DockServer).
public class MainActivity extends Activity implements Runnable {
    WebView web;
    DockServer server;
    final ConcurrentLinkedQueue<String> inbox = new ConcurrentLinkedQueue<>();

    // Called on the server thread.
    void deliver(String msg) { inbox.add(msg); web.post(this); }

    // Messages arrive from the network: pass them as a quoted string, never as raw JS.
    @Override public void run() {
        for (String m; (m = inbox.poll()) != null; ) web.evaluateJavascript("dock(JSON.parse(" + JSONObject.quote(m) + "))", null);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Draw into the camera-notch strip too (it showed as a black bar in landscape).
        getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        WebView.setWebContentsDebuggingEnabled(true); // lets the PC inspect/screenshot the page over adb
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true); // settings persist in localStorage
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFF000000);
        web.addJavascriptInterface(this, "Dock"); // page -> PC (prev/play/next/seek); only @JavascriptInterface methods are exposed
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        kiosk();
        server = new DockServer(this);
        server.start();
    }

    @JavascriptInterface
    public void send(String json) { if (server != null) server.broadcast(json); }

    @Override
    protected void onResume() {
        super.onResume();
        hideBars();
        if (isOwner()) startLockTask();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        if (hasFocus) hideBars();
    }

    @Override
    protected void onDestroy() {
        try { server.stop(500); } catch (Exception ignored) {}
        super.onDestroy();
    }

    boolean isOwner() {
        return ((DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE)).isDeviceOwnerApp(getPackageName());
    }

    // Only does anything once we're device owner (adb shell dpm set-device-owner ...)
    void kiosk() {
        if (!isOwner()) return;
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, AdminReceiver.class);
        dpm.setLockTaskPackages(admin, new String[]{getPackageName()});
        dpm.setKeyguardDisabled(admin, true);
        dpm.setStatusBarDisabled(admin, true);
        dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7");
    }

    @SuppressWarnings("deprecation")
    void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
}
