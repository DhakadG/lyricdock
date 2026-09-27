package com.you.lyricdock;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Settings -> Screen -> Media notification: the playing song with previous / play-pause / next in the notification
// shade and on the lock screen, backed by a MediaSession (lock-screen controls; headset keys only reach apps that play audio). Runs on a worker thread
// because it downloads the cover; buttons come back through MediaReceiver / MediaCb into the page (mediaCmd).
class MediaNotif implements Runnable {
    static final String CHANNEL = "playback";
    static final int ID = 7;
    static MediaSession session;
    private static String lastArtUrl = "";
    private static Bitmap lastArt;
    private final MainActivity app;
    private final String title, artist, art;
    private final boolean playing;

    MediaNotif(MainActivity app, String title, String artist, String art, boolean playing) {
        this.app = app; this.title = title; this.artist = artist; this.art = art; this.playing = playing;
    }

    @Override public void run() {
        try { show(); } catch (Exception ignored) {} // a notification must never take the app down
    }

    private void show() {
        NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (title == null || title.isEmpty()) {
            nm.cancel(ID);
            synchronized (MediaNotif.class) { if (session != null) { session.setActive(false); session.release(); session = null; } }
            return;
        }
        Bitmap bmp = cover();
        synchronized (MediaNotif.class) {
            if (session == null) {
                session = new MediaSession(app, "LyricDock");
                session.setCallback(new MediaCb(app), new android.os.Handler(android.os.Looper.getMainLooper()));
                session.setActive(true);
            }
            session.setMetadata(new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, bmp).build());
            session.setPlaybackState(new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                    .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build());
        }
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Now playing", NotificationManager.IMPORTANCE_LOW));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(app, CHANNEL) : legacy();
        b.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title).setContentText(artist).setLargeIcon(bmp)
                .setOngoing(playing).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(PendingIntent.getActivity(app, 0, new Intent(app, MainActivity.class), PendingIntent.FLAG_IMMUTABLE))
                .addAction(action(android.R.drawable.ic_media_previous, "Previous", "prev"))
                .addAction(action(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pause" : "Play", "toggle"))
                .addAction(action(android.R.drawable.ic_media_next, "Next", "next"))
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        try { nm.notify(ID, b.build()); } catch (SecurityException ignored) {} // Android 13+ without the permission
    }

    @SuppressWarnings("deprecation")
    private Notification.Builder legacy() { return new Notification.Builder(app); }

    private Notification.Action action(int icon, String label, String cmd) {
        Intent i = new Intent(app, MediaReceiver.class).setAction("com.you.lyricdock.MEDIA").putExtra("cmd", cmd);
        PendingIntent pi = PendingIntent.getBroadcast(app, cmd.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(app, icon), label, pi).build();
    }

    // Covers change once per song: keep the last one.
    private Bitmap cover() {
        if (art == null || !art.startsWith("https://")) return null;
        synchronized (MediaNotif.class) { if (art.equals(lastArtUrl)) return lastArt; }
        Bitmap b = null;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(art).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(10000);
            try (InputStream in = c.getInputStream()) { b = BitmapFactory.decodeStream(in); }
            if (b != null && b.getWidth() > 512) b = Bitmap.createScaledBitmap(b, 512, 512 * b.getHeight() / b.getWidth(), true);
        } catch (Exception ignored) {}
        synchronized (MediaNotif.class) { lastArtUrl = art; lastArt = b; }
        return b;
    }
}
