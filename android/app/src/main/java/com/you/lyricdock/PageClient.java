package com.you.lyricdock;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.HashMap;
import java.util.Map;

// The page comes from file:///android_asset, which sends no Referer - and YouTube's embed refuses to play without
// one (Error 153). So the music-video background plays inside a small wrapper page served here from an https address:
// the embed then gets that page as its Referer like on any website.
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
        return null;
    }

    // Returning true keeps the app alive when the renderer dies; MainActivity swaps in a fresh WebView.
    @Override
    public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
        if (view.getContext() instanceof MainActivity) ((MainActivity) view.getContext()).rendererGone(view, detail != null && detail.didCrash());
        return true;
    }
}
