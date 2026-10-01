package com.you.lyricdock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Notification (MediaNotif) and widget (NowPlaying) buttons -> the running app. Not running: open it, since the
// app is what talks to Spotify.
public class MediaReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        MainActivity a = MainActivity.current;
        if (a != null) { a.mediaCmd(intent.getStringExtra("cmd")); return; }
        try { ctx.startActivity(new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
    }
}
