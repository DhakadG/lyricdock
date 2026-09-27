package com.you.lyricdock;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// App self-update from GitHub Releases (latest release, first .apk asset). Installed through PackageInstaller:
// silently when LyricDock is device owner, otherwise Android asks the user (InstallReceiver). Android only
// accepts an APK signed with the same key as the installed app, so a tampered download can't install.
// Reports {"type":"update","state":current|available|installing|error,"version"} to the page.
class Updater implements Runnable {
    static final String LATEST = "https://api.github.com/repos/DhakadG/lyricdock/releases/latest";
    static final String NEWEST = "https://api.github.com/repos/DhakadG/lyricdock/releases?per_page=1"; // includes pre-releases
    static volatile boolean beta;
    private final MainActivity app;
    private final boolean install;

    Updater(MainActivity app, boolean install) { this.app = app; this.install = install; }

    @Override public void run() {
        try {
            String cur = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
            JSONObject rel = beta ? new JSONArray(new String(get(NEWEST), "UTF-8")).getJSONObject(0) : new JSONObject(new String(get(LATEST), "UTF-8"));
            String tag = rel.getString("tag_name").replaceFirst("^v", "");
            String apk = null;
            JSONArray assets = rel.getJSONArray("assets");
            for (int i = 0; i < assets.length() && apk == null; i++)
                if (assets.getJSONObject(i).getString("name").endsWith(".apk")) apk = assets.getJSONObject(i).getString("browser_download_url");
            if (apk == null || !newer(tag, cur)) { report("current", cur); return; }
            report("available", tag);
            if (!install) return;
            File f = new File(app.getCacheDir(), "update.apk");
            try (OutputStream o = new FileOutputStream(f)) { o.write(get(apk)); }
            PackageInstaller pi = app.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            p.setAppPackageName(app.getPackageName());
            int id = pi.createSession(p);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("lyricdock.apk", 0, f.length())) {
                    byte[] buf = new byte[65536];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    s.fsync(out);
                }
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                s.commit(PendingIntent.getBroadcast(app, id, new Intent(app, InstallReceiver.class), flags).getIntentSender());
            }
            report("installing", tag);
        } catch (Exception e) {
            report("error", String.valueOf(e.getMessage()));
        }
    }

    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < 3; i++) {
            int p = i < x.length ? Integer.parseInt(x[i].replaceAll("\\D", "")) : 0, q = i < y.length ? Integer.parseInt(y[i].replaceAll("\\D", "")) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static byte[] get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream");
        c.setInstanceFollowRedirects(true);
        if (c.getResponseCode() >= 400) throw new Exception("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[65536];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private void report(String state, String version) {
        try { app.deliver(new JSONObject().put("type", "update").put("state", state).put("version", version).toString()); }
        catch (Exception ignored) {}
    }
}
