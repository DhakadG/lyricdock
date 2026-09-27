package com.you.lyricdock;

import android.media.session.MediaSession;

// MediaSession buttons (lock screen, headset, Bluetooth) -> the page's mediaCmd().
class MediaCb extends MediaSession.Callback {
    private final MainActivity app;

    MediaCb(MainActivity app) { this.app = app; }

    @Override public void onPlay() { app.mediaCmd("toggle"); }
    @Override public void onPause() { app.mediaCmd("toggle"); }
    @Override public void onSkipToNext() { app.mediaCmd("next"); }
    @Override public void onSkipToPrevious() { app.mediaCmd("prev"); }
}
