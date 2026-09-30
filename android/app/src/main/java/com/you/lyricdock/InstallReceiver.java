package com.you.lyricdock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

// Update install results (Updater) and "we were just updated" -> relaunch the dock.
public class InstallReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            String v = "";
            try { v = " to v" + ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName; } catch (Exception ignored) {}
            Reopen.now(ctx, "LyricDock updated" + v, "Tap to reopen the dock"); // Android 10+ blocks a plain startActivity here
            return;
        }
        // Not device owner: Android wants the user to confirm the install.
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }
}
