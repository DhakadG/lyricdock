package com.you.lyricdock;

import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.NotificationListenerService;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

// Playback source "Any app on this phone": follows whatever plays on the phone (YouTube Music,
// Apple Music, Spotify, a browser...) through its media session. Android hands other apps'
// sessions only to a notification listener, which the user switches on by hand (Settings ->
// Notification access; MainActivity.openPhoneAccess). Sends the page the same track / pos
// messages as the other sources (phone.js -> app.js route). Notifications themselves are never
// read.
public class PlayerWatch extends NotificationListenerService
        implements MediaSessionManager.OnActiveSessionsChangedListener, Runnable {
    static volatile PlayerWatch on;
    // The cover, served to the page at ART_URL (PageClient): the page only takes https covers.
    static final String ART_URL = "https://video.lyricdock.app/art/";
    static volatile byte[] art;

    private final PlayerCb cb = new PlayerCb(this);
    private final Handler h = new Handler(Looper.getMainLooper());
    private MediaSessionManager msm;
    private List<MediaController> list = new ArrayList<MediaController>();
    private MediaController cur;
    private String sentKey;
    private boolean sentArt, sentDur;
    private int artN;

    // Whether the user has switched notification access on for LyricDock.
    static boolean allowed(Context c) {
        String s =
                android.provider.Settings.Secure.getString(
                        c.getContentResolver(), "enabled_notification_listeners");
        return s != null && s.contains(new ComponentName(c, PlayerWatch.class).flattenToString());
    }

    @Override
    public void onListenerConnected() {
        on = this;
        msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        ComponentName me = new ComponentName(this, PlayerWatch.class);
        try {
            msm.addOnActiveSessionsChangedListener(this, me, h);
            onActiveSessionsChanged(msm.getActiveSessions(me));
        } catch (SecurityException e) { // access switched off meanwhile
            return;
        }
        h.removeCallbacks(this);
        h.postDelayed(this, 1000);
    }

    @Override
    public void onListenerDisconnected() {
        if (on == this) on = null;
        h.removeCallbacks(this);
        if (msm != null) msm.removeOnActiveSessionsChangedListener(this);
        for (MediaController c : list) c.unregisterCallback(cb);
        list = new ArrayList<MediaController>();
        cur = null;
    }

    @Override
    public void onActiveSessionsChanged(List<MediaController> now) {
        for (MediaController c : list) c.unregisterCallback(cb);
        list = new ArrayList<MediaController>();
        if (now != null)
            for (MediaController c : now)
                if (!getPackageName().equals(c.getPackageName())) { // our own media notification
                    c.registerCallback(cb, h);
                    list.add(c);
                }
        changed();
    }

    // A session started, stopped, or changed song / state: follow the one that plays. Android
    // lists sessions most recent first; one that keeps playing keeps the screen (two players
    // at once don't flap).
    void changed() {
        MediaController pick = playing(cur) ? cur : null;
        for (MediaController c : list) if (pick == null && playing(c)) pick = c;
        if (pick == null) pick = list.contains(cur) ? cur : list.isEmpty() ? null : list.get(0);
        if (pick != cur) sentKey = null;
        cur = pick;
        emit();
    }

    private static boolean playing(MediaController c) {
        PlaybackState s = c == null ? null : c.getPlaybackState();
        return s != null && s.getState() == PlaybackState.STATE_PLAYING;
    }

    // Once a second while a player is known: the position (the page's clock runs between beats).
    @Override
    public void run() {
        emit();
        h.postDelayed(this, 1000);
    }

    // The page (re)loaded: send the song again.
    static void resend() {
        PlayerWatch w = on;
        if (w != null) w.sentKey = null;
    }

    static void cmd(String c, double arg) {
        PlayerWatch w = on;
        MediaController m = w == null ? null : w.cur;
        if (m == null) return;
        MediaController.TransportControls t = m.getTransportControls();
        if ("toggle".equals(c)) {
            if (playing(m)) t.pause();
            else t.play();
        } else if ("next".equals(c)) t.skipToNext();
        else if ("prev".equals(c)) t.skipToPrevious();
        else if ("seek".equals(c)) t.seekTo(Math.max(0, (long) arg));
    }

    private void emit() {
        MainActivity a = MainActivity.current;
        MediaController c = cur;
        if (a == null || c == null) return;
        MediaMetadata md = c.getMetadata();
        PlaybackState st = c.getPlaybackState();
        if (md == null) return;
        String
                title =
                        text(
                                md,
                                MediaMetadata.METADATA_KEY_TITLE,
                                MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
                artist =
                        text(
                                md,
                                MediaMetadata.METADATA_KEY_ARTIST,
                                MediaMetadata.METADATA_KEY_ALBUM_ARTIST),
                album = text(md, MediaMetadata.METADATA_KEY_ALBUM, null),
                pkg = c.getPackageName();
        if (title.isEmpty()) return;
        long dur = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
        try {
            Bitmap bm = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (bm == null) bm = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            String key = pkg + '\n' + title + '\n' + artist;
            // Players often fill the cover in a moment after the title: the same song again, now
            // with it. Only then: YouTube Music hands over a fresh copy of the same cover with
            // every update.
            boolean song = !key.equals(sentKey);
            // The length can come late too, and the lyrics lookup needs it (phone.js waits for it).
            if (song || (bm != null && !sentArt) || (dur > 0 && !sentDur)) {
                sentDur = dur > 0;
                if (song || (bm != null && !sentArt)) {
                    sentArt = bm != null;
                    art = bm == null ? null : jpeg(bm);
                    artN++;
                }
                sentKey = key;
                // Spotify names the track in the media ID: then the Spicy API's word-synced lyrics
                // work too.
                String mid = text(md, MediaMetadata.METADATA_KEY_MEDIA_ID, null);
                java.util.regex.Matcher sp =
                        java.util.regex.Pattern.compile("spotify:track:([A-Za-z0-9]{22})")
                                .matcher(mid);
                JSONObject t = new JSONObject();
                t.put("type", "track");
                t.put("id", sp.find() ? sp.group(1) : "ph" + Integer.toHexString(key.hashCode()));
                t.put("title", title);
                t.put("artist", artist);
                t.put("a1", artist.split(",|&| feat\\.| x ")[0].trim());
                t.put("album", album);
                if (dur > 0) t.put("dur", dur);
                if (art != null) t.put("art", ART_URL + artN + ".jpg");
                t.put("app", pkg);
                t.put("appName", label(pkg));
                a.phone(t.toString());
            }
            if (st == null) return;
            boolean play = st.getState() == PlaybackState.STATE_PLAYING;
            long pos = st.getPosition();
            if (play && st.getLastPositionUpdateTime() > 0)
                pos +=
                        (long)
                                ((SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime())
                                        * st.getPlaybackSpeed());
            JSONObject p = new JSONObject();
            p.put("type", "pos");
            p.put("pos", Math.max(0, pos));
            p.put("playing", play);
            if (dur > 0) p.put("dur", dur);
            a.phone(p.toString());
        } catch (Exception ignored) {
        }
    }

    private static String text(MediaMetadata md, String k, String alt) {
        CharSequence s = md.getText(k);
        if ((s == null || s.length() == 0) && alt != null) s = md.getText(alt);
        return s == null ? "" : s.toString().trim();
    }

    private String label(String pkg) {
        try {
            return getPackageManager()
                    .getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0))
                    .toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    private static byte[] jpeg(Bitmap bm) {
        int w = bm.getWidth(), hh = bm.getHeight(), max = 800;
        if (Math.max(w, hh) > max) {
            float k = (float) max / Math.max(w, hh);
            bm = Bitmap.createScaledBitmap(bm, Math.round(w * k), Math.round(hh * k), true);
        }
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        bm.compress(Bitmap.CompressFormat.JPEG, 90, o);
        return o.toByteArray();
    }
}

// Any change on any followed session sends PlayerWatch round again (no inner classes: see
// DockServer).
class PlayerCb extends MediaController.Callback {
    private final PlayerWatch w;

    PlayerCb(PlayerWatch w) {
        this.w = w;
    }

    @Override
    public void onPlaybackStateChanged(PlaybackState s) {
        w.changed();
    }

    @Override
    public void onMetadataChanged(MediaMetadata m) {
        w.changed();
    }

    @Override
    public void onSessionDestroyed() {
        w.changed();
    }
}
