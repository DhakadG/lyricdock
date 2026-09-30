package com.you.lyricdock;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

// Crashes used to leave no trace ("it just closed"). Anything that takes the app down - an uncaught exception on any
// thread, or the page's renderer dying - is appended to files/crash.txt; the page reads it on the next start
// (Dock.lastCrash), shows a short notice and passes it to the desktop's diagnostics. The file is kept small.
class CrashLog implements Thread.UncaughtExceptionHandler {
    private final Context ctx;
    private final Thread.UncaughtExceptionHandler prev;

    private CrashLog(Context ctx, Thread.UncaughtExceptionHandler prev) { this.ctx = ctx.getApplicationContext(); this.prev = prev; }

    static void install(Context ctx) {
        Thread.UncaughtExceptionHandler cur = Thread.getDefaultUncaughtExceptionHandler();
        if (!(cur instanceof CrashLog)) Thread.setDefaultUncaughtExceptionHandler(new CrashLog(ctx, cur));
    }

    @Override public void uncaughtException(Thread t, Throwable e) {
        StringWriter w = new StringWriter();
        e.printStackTrace(new PrintWriter(w));
        String s = w.toString();
        note(ctx, "crash on " + t.getName() + ": " + (s.length() > 1500 ? s.substring(0, 1500) : s));
        try { Reopen.now(ctx, "LyricDock closed after a problem", "Tap to reopen - it has been noted"); } catch (Throwable ignored) {}
        if (prev != null) prev.uncaughtException(t, e); // Android still records it and ends the process
    }

    static synchronized void note(Context ctx, String what) {
        try {
            File f = new File(ctx.getFilesDir(), "crash.txt");
            if (f.length() > 16000) f.delete();
            try (FileOutputStream o = new FileOutputStream(f, true)) {
                o.write((new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()) + " v" + version(ctx) + " " + what + "\n").getBytes(Charset.forName("UTF-8")));
            }
        } catch (Exception ignored) {}
    }

    static synchronized String take(Context ctx) {
        try {
            File f = new File(ctx.getFilesDir(), "crash.txt");
            if (!f.exists()) return "";
            String s = new String(Files.readAllBytes(f.toPath()), Charset.forName("UTF-8"));
            f.delete();
            return s;
        } catch (Exception e) { return ""; }
    }

    private static String version(Context ctx) {
        try { return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }
}
