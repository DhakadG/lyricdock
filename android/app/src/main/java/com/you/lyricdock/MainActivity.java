package com.you.lyricdock;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.IntentFilter;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.RoundedCorner;
import android.view.WindowInsets;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.concurrent.ConcurrentLinkedQueue;

// Also the UI-thread Runnable that hands queued bridge messages to the page, and the insets listener
// (no inner/anonymous classes - see DockServer).
public class MainActivity extends Activity implements Runnable, View.OnApplyWindowInsetsListener {
    WebView web;
    FrameLayout root;
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
        if (Build.VERSION.SDK_INT >= 28) getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        WebView.setWebContentsDebuggingEnabled(true); // lets the PC inspect/screenshot the page over adb
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true); // settings persist in localStorage
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFF000000);
        web.addJavascriptInterface(this, "Dock"); // page -> PC (prev/play/next/seek); only @JavascriptInterface methods are exposed
        web.setOnApplyWindowInsetsListener(this);
        root = new FrameLayout(this); // hosts the dock page, and the Spotify login overlay when open
        root.addView(web);
        setContentView(root);
        web.loadUrl("file:///android_asset/index.html");
        kiosk();
        server = new DockServer(this);
        server.start();
    }

    @JavascriptInterface
    public void send(String json) { if (server != null) server.broadcast(json); }

    // Optional Spicy Lyrics API request with the user's own key (see LyricsFetch). Inputs are checked here, at the
    // boundary: a Spotify track id is 22 base62 chars, a publishable key is sl_pk_ + [A-Za-z0-9_-].
    @JavascriptInterface
    public void fetchLyrics(String id, String key) {
        if (id == null || key == null || !id.matches("[A-Za-z0-9]{22}") || !key.matches("sl_pk_[A-Za-z0-9_-]{8,200}")) return;
        new Thread(new LyricsFetch(this, id, key)).start();
    }

    // Spotify login overlay (LoginClient). Only Spotify's own authorize page may be opened.
    @JavascriptInterface
    public void login(String url) {
        if (url == null || !url.startsWith("https://accounts.spotify.com/authorize?")) return;
        runOnUiThread(new LoginClient(this, url));
    }

    // App updates from GitHub Releases (Updater): install=false only checks.
    @JavascriptInterface
    public void checkUpdate(boolean install) { new Thread(new Updater(this, install)).start(); }

    @JavascriptInterface
    public String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    // Settings -> "Orientation": auto (all four), landscape (both), portrait (both).
    @JavascriptInterface
    public void setOrientation(String mode) {
        int o = "landscape".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : "portrait".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;
        if (getRequestedOrientation() != o) setRequestedOrientation(o);
    }

    // Camera-cutout safe insets + rounded-corner radii in CSS px, refreshed on every insets change (rotation).
    volatile String insetsJson = "{}";

    @JavascriptInterface
    public String insets() { return insetsJson; }

    @Override
    public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
        float d = getResources().getDisplayMetrics().density;
        int l = 0, t = 0, r = 0, b = 0;
        DisplayCutout cut = Build.VERSION.SDK_INT >= 28 ? in.getDisplayCutout() : null;
        if (cut != null) { l = cut.getSafeInsetLeft(); t = cut.getSafeInsetTop(); r = cut.getSafeInsetRight(); b = cut.getSafeInsetBottom(); }
        int[] rc = new int[4];
        if (Build.VERSION.SDK_INT >= 31) {
            int[] pos = { RoundedCorner.POSITION_TOP_LEFT, RoundedCorner.POSITION_TOP_RIGHT,
                    RoundedCorner.POSITION_BOTTOM_LEFT, RoundedCorner.POSITION_BOTTOM_RIGHT };
            for (int i = 0; i < 4; i++) { RoundedCorner c = in.getRoundedCorner(pos[i]); rc[i] = c == null ? 0 : c.getRadius(); }
        }
        insetsJson = String.format(java.util.Locale.US,
                "{\"l\":%.1f,\"t\":%.1f,\"r\":%.1f,\"b\":%.1f,\"rtl\":%.1f,\"rtr\":%.1f,\"rbl\":%.1f,\"rbr\":%.1f}",
                l / d, t / d, r / d, b / d, rc[0] / d, rc[1] / d, rc[2] / d, rc[3] / d);
        web.evaluateJavascript("window.setInsets&&setInsets(" + insetsJson + ")", null);
        return in;
    }

    // Phone's LAN IPv4, so the bridge can learn it (and the waiting screen can show it). "" if none.
    @JavascriptInterface
    public String ip() {
        try {
            for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!n.isUp() || n.isLoopback()) continue;
                for (InetAddress a : Collections.list(n.getInetAddresses()))
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
            }
        } catch (Exception ignored) {}
        return "";
    }

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
        // Be the home screen only in kiosk mode (a normally installed app shouldn't hijack the Home button).
        getPackageManager().setComponentEnabledSetting(new ComponentName(this, getPackageName() + ".Home"),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        IntentFilter home = new IntentFilter(Intent.ACTION_MAIN);
        home.addCategory(Intent.CATEGORY_HOME);
        home.addCategory(Intent.CATEGORY_DEFAULT);
        dpm.addPersistentPreferredActivity(admin, home, new ComponentName(this, getPackageName() + ".Home"));
    }

    @JavascriptInterface
    public boolean kioskOn() { return isOwner(); }

    // Settings -> Leave kiosk mode: undo everything kiosk() did and give up device owner, from the phone itself
    // (no adb needed). Reinstall / setup-phone.ps1 turns it back on.
    @JavascriptInterface
    @SuppressWarnings("deprecation")
    public void leaveKiosk() {
        runOnUiThread(new KioskExit(this));
    }

    void exitKiosk() {
        if (!isOwner()) return;
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, AdminReceiver.class);
        try { stopLockTask(); } catch (Exception ignored) {}
        dpm.clearPackagePersistentPreferredActivities(admin, getPackageName());
        dpm.setKeyguardDisabled(admin, false);
        dpm.setStatusBarDisabled(admin, false);
        dpm.setLockTaskPackages(admin, new String[0]);
        getPackageManager().setComponentEnabledSetting(new ComponentName(this, getPackageName() + ".Home"),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        dpm.clearDeviceOwnerApp(getPackageName());
    }

    @SuppressWarnings("deprecation")
    void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
}
