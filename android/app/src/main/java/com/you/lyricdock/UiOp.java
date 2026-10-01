package com.you.lyricdock;

import android.os.Build;
import android.os.PowerManager;
import android.view.WindowManager;

// Small UI-thread jobs posted from the page's JavaScript thread (no inner/anonymous classes - see DockServer).
class UiOp implements Runnable {
    static final int BRIGHTNESS = 1, WAKE = 2, JS = 3, CLEAR_CACHE = 4;
    private final MainActivity a;
    private final int op;
    private final float f;
    private final String s;

    UiOp(MainActivity a, int op, float f, String s) { this.a = a; this.op = op; this.f = f; this.s = s; }

    @Override
    @SuppressWarnings("deprecation")
    public void run() {
        if (op == BRIGHTNESS) {
            WindowManager.LayoutParams lp = a.getWindow().getAttributes();
            lp.screenBrightness = f < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : Math.max(0.01f, Math.min(1f, f));
            a.getWindow().setAttributes(lp);
        } else if (op == WAKE) {
            if (Build.VERSION.SDK_INT >= 27) { a.setTurnScreenOn(true); a.setShowWhenLocked(true); }
            PowerManager pm = (PowerManager) a.getSystemService(MainActivity.POWER_SERVICE);
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "lyricdock:wake");
            wl.acquire(3000);
        } else if (op == CLEAR_CACHE && a.web != null) {
            a.web.clearCache(true);
        } else if (op == JS && a.web != null) {
            a.web.evaluateJavascript(s, null);
        }
    }
}
