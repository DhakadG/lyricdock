package com.you.lyricdock;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

// "Now playing" home-screen widget: lyric strip / now playing / lyrics, by size. Drawn by NowPlaying.
public class NowWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) { NowPlaying.redraw(ctx); }

    @Override public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle size) { NowPlaying.redraw(ctx); }
}
