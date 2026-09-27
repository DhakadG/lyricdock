package com.you.lyricdock;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

// The page comes from file:///android_asset, which sends no Referer - and YouTube's embed refuses to play without
// one (Error 153). For the embed document only, fetch it here with a Referer and hand it to the WebView; everything
// inside the player then loads normally with youtube-nocookie.com as its own referrer.
class PageClient extends WebViewClient {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        String url = req.getUrl().toString();
        // Wrapper page for the music-video background: served from an https address so the YouTube player inside it
        // has a proper embedding page (a file:// parent gets Error 153). It relays play/pause/seek from the app.
        if (url.startsWith("https://video.lyricdock.app/player")) {
            String id = req.getUrl().getQueryParameter("v"), start = req.getUrl().getQueryParameter("t");
            if (id == null || !id.matches("[A-Za-z0-9_-]{11}")) id = "";
            if (start == null || !start.matches("\\d{1,6}")) start = "0";
            String html = "<!doctype html><html><head><meta name=referrer content=origin><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}"
                    + "iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body>"
                    + "<iframe id=p allow=\"autoplay; encrypted-media\" src=\"https://www.youtube-nocookie.com/embed/" + id
                    + "?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&loop=1&playlist=" + id + "&playsinline=1&rel=0&iv_load_policy=3&enablejsapi=1"
                    + "&origin=https://video.lyricdock.app&start=" + start + "\"></iframe>"
                    + "<script>addEventListener('message',function(e){var p=document.getElementById('p');if(e.source===parent)p.contentWindow.postMessage(e.data,'*')})</script></body></html>";
            Map<String, String> h = new HashMap<String, String>();
            return new WebResourceResponse("text/html", "utf-8", 200, "OK", h, new java.io.ByteArrayInputStream(html.getBytes(java.nio.charset.Charset.forName("UTF-8"))));
        }
        if (!req.isForMainFrame() && "GET".equals(req.getMethod()) && url.startsWith("https://www.youtube-nocookie.com/embed/")) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(15000);
                c.setRequestProperty("Referer", "https://lyricdock.app/");
                c.setRequestProperty("User-Agent", view.getSettings().getUserAgentString());
                String lang = req.getRequestHeaders().get("Accept-Language");
                if (lang != null) c.setRequestProperty("Accept-Language", lang);
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                String type = c.getContentType() == null ? "text/html; charset=utf-8" : c.getContentType();
                String mime = type.split(";")[0].trim(), enc = type.contains("charset=") ? type.split("charset=")[1].trim() : "utf-8";
                Map<String, String> headers = new HashMap<String, String>();
                headers.put("Access-Control-Allow-Origin", "*");
                String reason = c.getResponseMessage() == null || c.getResponseMessage().isEmpty() ? "OK" : c.getResponseMessage();
                return new WebResourceResponse(mime, enc, code, reason, headers, in);
            } catch (Exception e) {
                return null; // let the WebView try normally
            }
        }
        return null;
    }
}
