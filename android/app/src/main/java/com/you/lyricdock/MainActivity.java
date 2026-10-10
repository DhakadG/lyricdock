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
import android.view.KeyEvent;
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
    static volatile MainActivity current; // for MediaReceiver (notification buttons)
    static volatile boolean volKeys = true;
    android.net.wifi.WifiManager.WifiLock wifiLock;

    // Called on the server thread.
    void deliver(String msg) { inbox.add(msg); web.post(this); }

    // Messages arrive from the network: pass them as a quoted string, never as raw JS.
    @Override public void run() {
        for (String m; (m = inbox.poll()) != null; ) web.evaluateJavascript("dock(JSON.parse(" + JSONObject.quote(m) + "))", null);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        current = this;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Draw into the camera-notch strip too (it showed as a black bar in landscape).
        if (Build.VERSION.SDK_INT >= 28) getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        CrashLog.install(this); // a crash on any thread is written down (shown on the next start) instead of vanishing
        // Development builds only (scripts/build-apk.ps1 without -Release): page inspection over adb, and the adb
        // link below. A release build has neither, so adb on the phone can't read the app's tokens or drive the page.
        boolean dev = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(dev);
        root = new FrameLayout(this); // hosts the dock page, and the Spotify login overlay when open
        setContentView(root);
        makeWeb();
        kiosk();
        // Keep Wi-Fi out of power-save while the dock runs: its naps stalled the WebRTC link long enough to drop.
        try {
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            wifiLock = wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "lyricdock:link");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (Exception ignored) {}
        if (dev) { server = new DockServer(this); server.start(); }
        signedIn(getIntent()); // started cold by the sign-in link
    }

    // ---- LyricDock sign-in (account.js). Google won't sign in inside a WebView, so the page opens auth.lyricdock in
    // the phone's browser; it comes back here as lyricdock://signed-in?code=... (intent filter in AndroidManifest.xml).
    static final String SIGN_IN = "https://auth.lyricdock.losthusky.qzz.io/login?";
    volatile String ssoLink;

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        signedIn(i);
    }

    void signedIn(Intent i) {
        android.net.Uri u = i == null ? null : i.getData();
        if (u == null || !"lyricdock".equals(u.getScheme()) || !"signed-in".equals(u.getHost())) return;
        ssoLink = u.toString(); // the code is only good with the verifier the page kept, so a forged link can't sign in
        if (web != null) web.evaluateJavascript("window.Account&&Account.check()", null);
    }

    // The link once (the page also asks on start, in case it arrived before the page was ready).
    @JavascriptInterface
    public String ssoResult() { String s = ssoLink; ssoLink = null; return s == null ? "" : s; }

    // Only auth.lyricdock's sign-in page may be opened. false = no browser on the phone.
    @JavascriptInterface
    public boolean signIn(String url) {
        if (url == null || !url.startsWith(SIGN_IN) || url.length() > 300) return false;
        Intent v = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
        if (v.resolveActivity(getPackageManager()) == null) return false;
        runOnUiThread(new UiOp(this, UiOp.OPEN_URL, 0, url));
        return true;
    }

    void openBrowser(String url) {
        // Kiosk mode pins the dock (lock task), which would keep the browser from opening: unpin while signing in.
        // onResume pins it again when the sign-in link brings the dock back.
        if (isOwner()) try { stopLockTask(); } catch (Exception ignored) {}
        try { startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { web.evaluateJavascript("window.Account&&Account.noBrowser()", null); }
    }

    void makeWeb() {
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true); // settings persist in localStorage
        web.getSettings().setMediaPlaybackRequiresUserGesture(false); // muted music-video background autoplays
        web.getSettings().setSupportZoom(false); // a dock, not a page: no pinch / double-tap zoom
        web.getSettings().setBuiltInZoomControls(false);
        web.getSettings().setTextZoom(100); // ignore the system font-size zoom (layout is sized in vmin)
        web.setWebViewClient(new PageClient()); // adds the Referer YouTube's embed needs; recovers a dead renderer
        web.setBackgroundColor(0xFF000000);
        web.addJavascriptInterface(this, "Dock"); // page -> PC (prev/play/next/seek); only @JavascriptInterface methods are exposed
        web.setOnApplyWindowInsetsListener(this);
        root.addView(web, 0);
        web.loadUrl("file:///android_asset/index.html");
        web.requestApplyInsets();
    }

    // The page's renderer process died (out of memory, a GPU driver fault...). Left alone, Android kills the whole app
    // with it - the "it just closed" crashes. Instead: note it, throw the dead WebView away and start a fresh page;
    // the bridge reconnects and the song comes back within a few seconds.
    void rendererGone(WebView dead, boolean crashed) {
        if (dead != web) return;
        CrashLog.note(this, "renderer " + (crashed ? "crashed" : "was killed for memory"));
        root.removeView(dead);
        try { dead.destroy(); } catch (Exception ignored) {}
        makeWeb();
    }

    // What went wrong last time (the page shows a notice and hands it to the desktop's diagnostics), then forgotten.
    @JavascriptInterface
    public String lastCrash() { return CrashLog.take(this); }

    @JavascriptInterface
    public void send(String json) { if (server != null) server.broadcast(json); }

    // Device name for the desktop's phone list ("Galaxy M01"), else the model.
    @JavascriptInterface
    public String model() {
        String n = Settings.Global.getString(getContentResolver(), "device_name");
        return n != null && !n.isEmpty() ? n : Build.MODEL;
    }

    // Settings -> Screen: brightness (-1 = follow Android), volume keys -> Spotify, media notification, wake.
    @JavascriptInterface
    public void brightness(float v) { runOnUiThread(new UiOp(this, UiOp.BRIGHTNESS, v, null)); }

    @JavascriptInterface
    public void setVolKeys(boolean on) { volKeys = on; }

    // Flip clock haptics: a short tick (5..80 ms; a basic motor needs ~30 ms to be felt), light amplitude where supported.
    @JavascriptInterface
    @SuppressWarnings("deprecation")
    public void vibrate(int ms) {
        android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        int t = Math.max(5, Math.min(80, ms));
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createOneShot(t, v.hasAmplitudeControl() ? 90 : android.os.VibrationEffect.DEFAULT_AMPLITUDE));
        else v.vibrate(t);
    }

    @JavascriptInterface
    public void wake() { runOnUiThread(new UiOp(this, UiOp.WAKE, 0, null)); }

    @JavascriptInterface
    public void media(String title, String artist, String art, boolean playing) {
        if (Build.VERSION.SDK_INT >= 33 && title != null && !title.isEmpty()
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED && !askedNotif) {
            askedNotif = true;
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
        new Thread(new MediaNotif(this, title, artist, art, playing)).start();
    }
    private boolean askedNotif;

    // Notification / lock-screen / headset buttons -> the page. Only the three known commands pass.
    void mediaCmd(String cmd) {
        if ("toggle".equals(cmd) || "next".equals(cmd) || "prev".equals(cmd))
            runOnUiThread(new UiOp(this, UiOp.JS, 0, "window.mediaCmd&&mediaCmd('" + cmd + "')"));
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (volKeys && (k == KeyEvent.KEYCODE_VOLUME_UP || k == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) web.evaluateJavascript("window.volKey&&volKey(" + (k == KeyEvent.KEYCODE_VOLUME_UP ? 1 : -1) + ")", null);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @JavascriptInterface
    public void setChannel(String ch) { Updater.beta = "beta".equals(ch); }

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

    // Home-screen widgets: the page sends the now-playing state only while one is placed (NowPlaying draws it).
    @JavascriptInterface
    public boolean hasWidgets() { return NowPlaying.placed(this); }

    @JavascriptInterface
    public void nowPlaying(String json) { NowPlaying.push(this, json); }

    // Settings -> Screen -> "Show over the lock screen while playing": the dock instead of the lock screen.
    @JavascriptInterface
    public void showOverLock(boolean on) { runOnUiThread(new UiOp(this, UiOp.OVER_LOCK, on ? 1 : 0, null)); }

    // Settings -> Storage: the WebView's HTTP cache (still covers, artist images, fonts) lives in the app's cache dir.
    @JavascriptInterface
    public long webCacheBytes() { return dirBytes(getCacheDir()); }

    @JavascriptInterface
    public void clearWebCache() { runOnUiThread(new UiOp(this, UiOp.CLEAR_CACHE, 0, null)); }

    static long dirBytes(java.io.File f) {
        if (f == null) return 0;
        if (f.isFile()) return f.length();
        long n = 0;
        java.io.File[] kids = f.listFiles();
        if (kids != null) for (java.io.File k : kids) n += dirBytes(k);
        return n;
    }

    @JavascriptInterface
    public String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    // Settings -> "Orientation": auto (all four), landscape (both), portrait (both), or one fixed way (the quick bar's
    // rotate button; screen.orientation type names, same as the web shim locks).
    @JavascriptInterface
    public void setOrientation(String mode) {
        int o = "landscape".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : "portrait".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                : "landscape-primary".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                : "portrait-primary".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : "landscape-secondary".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
                : "portrait-secondary".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
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

    // Settings -> Updates -> Reopen by itself: may the dock start itself after an update / crash (Reopen.java)?
    @JavascriptInterface
    public boolean canReopen() { return Reopen.canSelfStart(this); }

    @JavascriptInterface
    public void askReopen() {
        try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:" + getPackageName()))); }
        catch (Exception e) { try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)); } catch (Exception ignored) {} }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Reopen.clear(this); // back on screen: the "tap to reopen" notification has done its job
        if (web != null) web.evaluateJavascript("window.Settings&&Settings.render&&Settings.render()", null); // e.g. back from granting "Reopen by itself"
        hideBars();
        if (isOwner()) startLockTask();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        if (hasFocus) hideBars();
    }

    @Override
    protected void onDestroy() {
        try { if (server != null) server.stop(500); } catch (Exception ignored) {}
        if (current == this) current = null;
        try { if (wifiLock != null) wifiLock.release(); } catch (Exception ignored) {}
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

    // Settings -> Screen -> Keep the screen on: FLAG_KEEP_SCREEN_ON, and in kiosk mode also the "stay on while
    // plugged in" global setting (otherwise that would keep it on regardless).
    @JavascriptInterface
    public void keepAwake(boolean on) { runOnUiThread(new Awake(this, on)); }

    void applyAwake(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (isOwner()) try {
            ((DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE)).setGlobalSetting(
                    new ComponentName(this, AdminReceiver.class), Settings.Global.STAY_ON_WHILE_PLUGGED_IN, on ? "7" : "0");
        } catch (Exception ignored) {}
    }

    // "level,charging" for Settings -> Screen -> Battery indicator.
    @JavascriptInterface
    public String battery() {
        Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (b == null) return "";
        int level = b.getIntExtra("level", -1), scale = b.getIntExtra("scale", 100), status = b.getIntExtra("status", -1);
        boolean charging = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING || status == android.os.BatteryManager.BATTERY_STATUS_FULL;
        return (level * 100 / Math.max(1, scale)) + "," + (charging ? 1 : 0);
    }

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
