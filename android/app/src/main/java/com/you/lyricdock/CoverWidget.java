package com.you.lyricdock;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

// "Cover" home-screen widget: the album cover, or a clock beside it when wide. Drawn by NowPlaying.
public class CoverWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) { NowPlaying.redraw(ctx); }

    @Override public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle size) { NowPlaying.redraw(ctx); }
}
