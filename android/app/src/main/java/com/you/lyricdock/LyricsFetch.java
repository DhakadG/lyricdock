package com.you.lyricdock;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// One Spicy Lyrics API request (GET /v1/lyrics/{id}) on a background thread. Native, so no Origin header is sent:
// the user's publishable key needs "No origin header" allowed. The answer goes back to the page as
// {"type":"api","id","status","text"}. Top-level class: the Gradle-free build can't dex inner/anonymous ones.
class LyricsFetch implements Runnable {
    private final MainActivity app;
    private final String id, key;

    LyricsFetch(MainActivity app, String id, String key) { this.app = app; this.id = id; this.key = key; }

    @Override public void run() {
        int status = 0;
        String text = "";
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://api.spicylyrics.org/v1/lyrics/" + id).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(8000);
            c.setRequestProperty("Authorization", "Bearer " + key);
            c.setRequestProperty("Accept", "application/json");
            status = c.getResponseCode();
            InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
            if (in != null) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                text = out.toString("UTF-8");
                in.close();
            }
            c.disconnect();
        } catch (Exception ignored) {}
        try {
            app.deliver(new JSONObject().put("type", "api").put("id", id).put("status", status).put("text", text).toString());
        } catch (Exception ignored) {}
    }
}
