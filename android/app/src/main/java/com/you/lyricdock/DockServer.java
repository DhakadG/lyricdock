package com.you.lyricdock;

import android.util.Log;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;

// WebSocket server the Spicetify bridge connects to (USB via adb forward, or Wi-Fi).
// Top-level on purpose: the Gradle-free build (javac + d8) crashes on inner/anonymous classes.
// Note: WebSocketServer's own run() is the server loop - never override it.
class DockServer extends WebSocketServer {
    static final int PORT = 8975; // 8974 is taken by WebNowPlaying

    private final MainActivity app;

    DockServer(MainActivity app) {
        super(new InetSocketAddress(PORT));
        this.app = app;
        setReuseAddr(true);
        setConnectionLostTimeout(2);
    }

    @Override public void onMessage(WebSocket c, String msg) { app.deliver(msg); }
    @Override public void onOpen(WebSocket c, ClientHandshake h) {}
    @Override public void onClose(WebSocket c, int code, String reason, boolean remote) {}
    @Override public void onError(WebSocket c, Exception e) { Log.w("LyricDock", e); }
    @Override public void onStart() { Log.i("LyricDock", "listening on " + PORT); }
}
