package com.you.lyricdock;

import android.util.Log;

import org.java_websocket.WebSocket;
import org.java_websocket.drafts.Draft;
import org.java_websocket.exceptions.InvalidDataException;
import org.java_websocket.framing.CloseFrame;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.handshake.ServerHandshakeBuilder;
import org.java_websocket.server.WebSocketServer;

import java.net.InetAddress;
import java.net.InetSocketAddress;

// Development link only (debuggable builds, MainActivity): the Spicetify bridge reaches it through `adb forward`,
// which arrives on the phone's loopback - so it listens on 127.0.0.1 only. Never on the Wi-Fi: it carries the
// pairing code and settings, and has no other authentication.
// Top-level on purpose: the Gradle-free build (javac + d8) crashes on inner/anonymous classes.
// Note: WebSocketServer's own run() is the server loop - never override it.
class DockServer extends WebSocketServer {
    static final int PORT = 8975; // 8974 is taken by WebNowPlaying

    private final MainActivity app;

    DockServer(MainActivity app) {
        super(new InetSocketAddress(InetAddress.getLoopbackAddress(), PORT));
        this.app = app;
        setReuseAddr(true);
        setConnectionLostTimeout(2);
    }

    // Spotify's page (adb forward) or a native client without an Origin; a web page opened on the phone itself is refused.
    @Override
    public ServerHandshakeBuilder onWebsocketHandshakeReceivedAsServer(WebSocket c, Draft d, ClientHandshake h) throws InvalidDataException {
        String o = h.getFieldValue("Origin");
        if (o != null && !o.isEmpty() && !o.matches("https://[a-z0-9.-]+\\.spotify\\.com"))
            throw new InvalidDataException(CloseFrame.POLICY_VALIDATION, "origin not allowed");
        return super.onWebsocketHandshakeReceivedAsServer(c, d, h);
    }

    @Override public void onMessage(WebSocket c, String msg) { app.deliver(msg); }
    @Override public void onOpen(WebSocket c, ClientHandshake h) {}
    @Override public void onClose(WebSocket c, int code, String reason, boolean remote) {}
    @Override public void onError(WebSocket c, Exception e) { Log.w("LyricDock", e); }
    @Override public void onStart() { Log.i("LyricDock", "listening on 127.0.0.1:" + PORT); }
}
