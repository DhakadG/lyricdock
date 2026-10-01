package com.you.lyricdock;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.content.res.ColorStateList;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Home-screen widgets (docs/widgets-plan.md). The page pushes the shared now-playing state (Dock.nowPlaying, JSON:
// title, artist, cover, playing, position, the sung line and its neighbours). It is kept in SharedPreferences, so
// widgets redraw after a reboot or a launcher restart, and drawn into every placed widget.
// One worker thread with a single "latest" slot: states arriving faster than it draws simply replace each other.
// A new song sends the cover (a full update); a new lyric line or play state only sends text (a partial update).
// No inner or anonymous classes: d8 in the Gradle-free build crashes on them (see UiOp).
final class NowPlaying implements Runnable {
    private static final String PREFS = "widgets", KEY = "state";
    private static final long GAP_MS = 400; // at most ~2 redraws a second, whatever the page sends
    private static final int ART_PX = 300;
    private static String latest, drawnId = "", artUrl = "";
    private static Bitmap art, glow; // glow: the blurred, saturated cover behind the widget (the app's dynamic background)
    private static boolean busy;
    private final Context ctx;

    private NowPlaying(Context ctx) { this.ctx = ctx; }

    static void push(Context ctx, String json) {
        synchronized (NowPlaying.class) {
            latest = json;
            if (busy) return;
            busy = true;
        }
        new Thread(new NowPlaying(ctx.getApplicationContext()), "widgets").start();
    }

    // Placed, resized, launcher restarted, phone rebooted: draw the last known state in full.
    static void redraw(Context ctx) {
        synchronized (NowPlaying.class) { drawnId = ""; }
        push(ctx, ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}"));
        MainActivity a = MainActivity.current; // running: send the live state now instead of within the minute
        if (a != null) a.runOnUiThread(new UiOp(a, UiOp.JS, 0, "window.dockWidgets && dockWidgets()"));
    }

    static boolean placed(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        return ids(ctx, m, NowWidget.class).length + ids(ctx, m, CoverWidget.class).length > 0;
    }

    @Override public void run() {
        while (true) {
            String json;
            synchronized (NowPlaying.class) {
                json = latest;
                latest = null;
                if (json == null) { busy = false; return; }
            }
            try { draw(json); } catch (Exception ignored) {} // a widget must never take the app down
            try { Thread.sleep(GAP_MS); } catch (InterruptedException e) { synchronized (NowPlaying.class) { busy = false; } return; }
        }
    }

    private void draw(String json) throws Exception {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) { drawnId = ""; return; } // screen off: saved, one full redraw once it's back
        JSONObject s = new JSONObject(json);
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        String id = s.optString("id");
        boolean full = !id.equals(drawnId);
        if (full) { cover(s.optString("art")); drawnId = id; }
        for (int w : ids(ctx, m, NowWidget.class)) {
            RemoteViews v = nowViews(s, m.getAppWidgetOptions(w), full);
            if (full) m.updateAppWidget(w, v); else m.partiallyUpdateAppWidget(w, v);
        }
        if (full) for (int w : ids(ctx, m, CoverWidget.class)) m.updateAppWidget(w, coverViews(s, m.getAppWidgetOptions(w)));
    }

    // "Now playing": the layout follows the widget's height - a lyric strip, now playing, or the lyrics.
    private RemoteViews nowViews(JSONObject s, Bundle size, boolean full) {
        int h = size(size)[1];
        int layout = h > 0 && h < 76 ? R.layout.w_strip : h >= 200 ? R.layout.w_lyrics : R.layout.w_now;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout);
        JSONObject line = s.optJSONObject("line");
        String text = line != null ? line.optString("text") : "";
        boolean playing = s.optBoolean("playing");
        v.setTextViewText(R.id.w_line, !text.isEmpty() ? text : layout == R.layout.w_strip ? s.optString("title") : "♪");
        if (full) { cover(v); background(v); v.setOnClickPendingIntent(R.id.w_root, openApp()); }
        if (layout == R.layout.w_strip) return v;

        boolean medium = layout == R.layout.w_now; // one line for both there: "Title · Artist"
        v.setTextViewText(R.id.w_title, medium ? s.optString("title") + "  ·  " + s.optString("artist") : s.optString("title"));
        v.setTextViewText(R.id.w_artist, s.optString("artist"));
        v.setImageViewResource(R.id.w_play, playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        long dur = s.optLong("durMs"), pos = s.optLong("posMs") + (playing ? System.currentTimeMillis() - s.optLong("atMs") : 0);
        v.setProgressBar(R.id.w_progress, 1000, dur > 0 ? (int) Math.min(1000, Math.max(0, pos * 1000 / dur)) : 0, false);
        if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(R.id.w_progress, "setProgressTintList", ColorStateList.valueOf(accent(s.optString("accent"))));
        if (layout == R.layout.w_lyrics) {
            JSONArray next = s.optJSONArray("next");
            v.setTextViewText(R.id.w_prevline, s.optString("prev"));
            v.setTextViewText(R.id.w_next1, next != null ? next.optString(0) : "");
            v.setTextViewText(R.id.w_next2, next != null ? next.optString(1) : "");
            v.setViewVisibility(R.id.w_next2, h >= 260 ? android.view.View.VISIBLE : android.view.View.GONE); // room for a fourth line
        }
        if (full) {
            v.setOnClickPendingIntent(R.id.w_prev, command("prev"));
            v.setOnClickPendingIntent(R.id.w_play, command("toggle"));
            v.setOnClickPendingIntent(R.id.w_next, command("next"));
        }
        return v;
    }

    // "Cover": the cover with the song, or a clock beside it when the widget is wide.
    private RemoteViews coverViews(JSONObject s, Bundle size) {
        boolean clock = size(size)[0] >= 270;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), clock ? R.layout.w_clock : R.layout.w_cover);
        if (clock) background(v);
        v.setTextViewText(R.id.w_title, s.optString("title"));
        v.setTextViewText(R.id.w_artist, s.optString("artist"));
        cover(v);
        v.setOnClickPendingIntent(R.id.w_root, openApp());
        return v;
    }

    // The size the widget really has now: Android reports portrait as min width x max height, landscape the other way.
    private int[] size(Bundle o) {
        boolean portrait = ctx.getResources().getConfiguration().orientation != android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        return portrait
            ? new int[] { o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH), o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) }
            : new int[] { o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH), o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) };
    }

    private void background(RemoteViews v) {
        if (glow != null) v.setImageViewBitmap(R.id.w_bg, glow); else v.setImageViewResource(R.id.w_bg, R.drawable.w_bg_empty);
    }

    private void cover(RemoteViews v) {
        if (art != null) v.setImageViewBitmap(R.id.w_cover, art); else v.setImageViewResource(R.id.w_cover, R.drawable.w_art);
    }

    private PendingIntent openApp() {
        return PendingIntent.getActivity(ctx, 0, new Intent(ctx, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
    }

    // Widget buttons go through the same receiver as the media notification's.
    private PendingIntent command(String cmd) {
        Intent i = new Intent(ctx, MediaReceiver.class).setAction("com.you.lyricdock.MEDIA").putExtra("cmd", cmd);
        return PendingIntent.getBroadcast(ctx, 100 + cmd.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // The page's accent is "r, g, b" (the CSS variable): the progress bar's colour; empty = plain white.
    private static int accent(String rgb) {
        try {
            String[] p = rgb.split(",");
            return Color.rgb(Integer.parseInt(p[0].trim()), Integer.parseInt(p[1].trim()), Integer.parseInt(p[2].trim()));
        } catch (Exception e) { return Color.WHITE; }
    }

    // One cover download per song, scaled down: widget bitmaps travel to the launcher on every full update.
    private static void cover(String url) {
        if (url == null || !url.startsWith("https://") || url.equals(artUrl)) return;
        Bitmap b = null;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(10000);
            try (InputStream in = c.getInputStream()) { b = BitmapFactory.decodeStream(in); }
            if (b != null) b = Bitmap.createScaledBitmap(b, ART_PX, ART_PX * b.getHeight() / Math.max(1, b.getWidth()), true);
        } catch (Exception ignored) {}
        art = b;
        glow = b != null ? glow(b) : null;
        artUrl = url;
    }

    // The app's background, cheaply: shrink the cover to a few pixels and scale it back up smoothly (a wide blur),
    // then boost the colour and dim it so white text stays readable.
    private static Bitmap glow(Bitmap src) {
        Bitmap small = Bitmap.createScaledBitmap(src, 12, 12, true);
        Bitmap mid = Bitmap.createScaledBitmap(small, 48, 48, true);
        Bitmap out = Bitmap.createBitmap(240, 240, Bitmap.Config.ARGB_8888);
        ColorMatrix cm = new ColorMatrix();
        cm.setSaturation(1.7f);
        ColorMatrix dim = new ColorMatrix(new float[] { .62f, 0, 0, 0, 0, 0, .62f, 0, 0, 0, 0, 0, .62f, 0, 0, 0, 0, 0, 1, 0 });
        cm.postConcat(dim);
        Paint p = new Paint(Paint.FILTER_BITMAP_FLAG);
        p.setColorFilter(new ColorMatrixColorFilter(cm));
        new Canvas(out).drawBitmap(mid, null, new android.graphics.Rect(0, 0, 240, 240), p);
        return out;
    }

    private static int[] ids(Context ctx, AppWidgetManager m, Class<?> provider) {
        return m.getAppWidgetIds(new ComponentName(ctx, provider));
    }
}
