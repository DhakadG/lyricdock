package com.you.lyricdock;

import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

// The page's microphone (listen.js: naming the song playing nearby). Only audio capture is ever granted; Android asks the
// user once for the app's own permission, and the page's request waits for that answer (MainActivity
// onRequestPermissionsResult).
class ChromeClient extends WebChromeClient {
    static final int MIC = 41;
    private final MainActivity a;
    private PermissionRequest waiting;

    ChromeClient(MainActivity a) {
        this.a = a;
    }

    @Override
    public void onPermissionRequest(PermissionRequest r) {
        boolean audioOnly = true;
        for (String res : r.getResources())
            if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) audioOnly = false;
        if (!audioOnly) {
            r.deny();
            return;
        }
        if (Build.VERSION.SDK_INT < 23
                || a.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED) {
            r.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (waiting != null) waiting.deny();
        waiting = r;
        a.requestPermissions(new String[] {android.Manifest.permission.RECORD_AUDIO}, MIC);
    }

    void answered(boolean ok) {
        PermissionRequest r = waiting;
        waiting = null;
        if (r == null) return;
        if (ok) r.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else r.deny();
    }
}
