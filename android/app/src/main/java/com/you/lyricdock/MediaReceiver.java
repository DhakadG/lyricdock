package com.you.lyricdock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Notification buttons (MediaNotif) -> the running app.
public class MediaReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        MainActivity a = MainActivity.current;
        if (a != null) a.mediaCmd(intent.getStringExtra("cmd"));
    }
}
