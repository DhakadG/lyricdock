package com.you.lyricdock;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

// Bring the dock back after something closed it (a self-update, a crash). Android 10+ doesn't let an app open its own
// screen from the background, so after an update the dock used to just vanish. Two ways back:
//  - allowed to "Display over other apps" (Settings -> Updates -> Reopen by itself; one switch, no adb) or device owner:
//    Android lets it start the activity directly;
//  - otherwise a high-priority notification: tap to reopen, and with the screen off it opens by itself (full-screen intent).
class Reopen {
    static final String CHANNEL = "reopen";
    static final int ID = 8;

    static boolean canSelfStart(Context ctx) {
        try {
            if (Settings.canDrawOverlays(ctx)) return true;
            android.app.admin.DevicePolicyManager dpm = (android.app.admin.DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            return dpm != null && dpm.isDeviceOwnerApp(ctx.getPackageName());
        } catch (Exception e) { return false; }
    }

    static void now(Context ctx, String title, String text) {
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (canSelfStart(ctx)) {
            try { ctx.startActivity(open); return; } catch (Exception ignored) {}
        }
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Reopen LyricDock", NotificationManager.IMPORTANCE_HIGH));
            PendingIntent pi = PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : legacy(ctx);
            b.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(title).setContentText(text)
                    .setContentIntent(pi).setFullScreenIntent(pi, true).setAutoCancel(true)
                    .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PUBLIC);
            nm.notify(ID, b.build());
        } catch (Exception ignored) {} // Android 13+ without the notification permission: nothing more we can do
        try { ctx.startActivity(open); } catch (Exception ignored) {} // works anyway on some phones / while in front
    }

    static void clear(Context ctx) {
        try { ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(ID); } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private static Notification.Builder legacy(Context ctx) { return new Notification.Builder(ctx); }
}
