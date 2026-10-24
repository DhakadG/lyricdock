package com.you.lyricdock;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import android.util.Base64;

// Listen's microphone in the phone app (listen.js): the page's own getUserMedia opens the mic as for a call, and with
// Bluetooth earbuds connected Android then switches them to their headset mic (SCO) - which cuts the music playing into
// them (from this phone or, with multipoint buds, from the PC). Recorded here instead: the phone's own microphone, in
// normal audio mode, 16 kHz mono, into a 20 s ring the page reads (level, then the last few seconds as PCM).
class NativeEar implements Runnable {
    static final int RATE = 16000, RING = RATE * 20;
    private static NativeEar on;
    private final short[] ring = new short[RING];
    private int w;
    private long total, lastAt; // samples written; SystemClock.elapsedRealtime() of the last block
    private float level;
    private volatile boolean stop;
    private AudioRecord rec;

    // which: "phone" (built-in, default) or "headset" (wired / USB). A Bluetooth headset's mic is never used: it would
    // switch the earbuds to their call mode and cut the music in them.
    static synchronized boolean start(Context c, String which) {
        if (on != null) return true;
        if (c.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) return false;
        NativeEar e = new NativeEar();
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        try {
            e.rec =
                    new AudioRecord(
                            MediaRecorder.AudioSource.MIC,
                            RATE,
                            AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT,
                            Math.max(min, RATE));
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            AudioDeviceInfo builtin = null, headset = null;
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_BUILTIN_MIC) builtin = d;
                else if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_USB_HEADSET
                        || t == AudioDeviceInfo.TYPE_USB_DEVICE) headset = d;
            }
            AudioDeviceInfo pick = "headset".equals(which) && headset != null ? headset : builtin;
            if (pick != null) e.rec.setPreferredDevice(pick);
            e.rec.startRecording();
        } catch (Exception x) {
            if (e.rec != null) e.rec.release();
            return false;
        }
        on = e;
        new Thread(e, "lyricdock-ear").start();
        return true;
    }

    static synchronized void stop() {
        if (on != null) on.stop = true;
        on = null;
    }

    @Override
    public void run() {
        short[] buf = new short[1024];
        while (!stop) {
            int n = rec.read(buf, 0, buf.length);
            if (n <= 0) continue;
            double sum = 0;
            synchronized (this) {
                for (int i = 0; i < n; i++) {
                    ring[w] = buf[i];
                    w = (w + 1) % RING;
                    sum += (double) buf[i] * buf[i];
                }
                total += n;
                lastAt = SystemClock.elapsedRealtime();
                level = (float) (Math.sqrt(sum / n) / 32768.0);
            }
        }
        try {
            rec.stop();
        } catch (Exception ignored) {
        }
        rec.release();
    }

    // {"rms": the last block's loudness (0..1), "total": samples so far, "age": ms since that block}
    static String level() {
        NativeEar e = on;
        if (e == null) return "null";
        synchronized (e) {
            return "{\"rms\":"
                    + e.level
                    + ",\"total\":"
                    + e.total
                    + ",\"age\":"
                    + (SystemClock.elapsedRealtime() - e.lastAt)
                    + "}";
        }
    }

    // The last `ms` of sound as base64 little-endian 16-bit PCM at 16 kHz, after "<age ms>," (ms since its end).
    static String clip(int ms) {
        NativeEar e = on;
        if (e == null) return "";
        synchronized (e) {
            int n = (int) Math.min(Math.min((long) ms * RATE / 1000, e.total), RING);
            byte[] out = new byte[n * 2];
            int r = (e.w - n + RING) % RING;
            for (int i = 0; i < n; i++) {
                short s = e.ring[(r + i) % RING];
                out[i * 2] = (byte) s;
                out[i * 2 + 1] = (byte) (s >> 8);
            }
            return (SystemClock.elapsedRealtime() - e.lastAt) + "," + Base64.encodeToString(out, Base64.NO_WRAP);
        }
    }
}
