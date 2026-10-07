// Local signalling relay: a tiny ntfy-compatible mailbox, so pairing and connection setup never leave the home
// network (phone Settings -> Connection -> Signalling server -> LyricDock Helper).
//   POST /<topic>          publish (the body is already AES-GCM ciphertext from the phone / Spotify)
//   GET  /<topic>/ws       WebSocket subscribe -> {"event":"message","topic":...,"message":...}
// Spotify reaches it at http://127.0.0.1:8977 (allowed from its https page), the phone at http://<this PC>:8977.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tungstenite::Message;

pub const PORT: u16 = 8977;
type Subs = Arc<Mutex<HashMap<String, Vec<Sender<String>>>>>;
static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static OPEN: AtomicUsize = AtomicUsize::new(0); // connections being served (each has a thread)
const MAX_OPEN: usize = 64; // a home needs a handful; a flood from the LAN can't exhaust the helper's threads

pub fn running() -> bool { RUNNING.load(Ordering::SeqCst) }

pub fn start() -> Result<(), String> {
    if running() { return Ok(()); }
    let l = TcpListener::bind(("0.0.0.0", PORT)).map_err(|e| format!("port {PORT} is busy: {e}"))?;
    STOP.store(false, Ordering::SeqCst);
    RUNNING.store(true, Ordering::SeqCst);
    let subs: Subs = Default::default();
    std::thread::spawn(move || {
        for s in l.incoming() {
            if STOP.load(Ordering::SeqCst) { break; }
            if let Ok(s) = s {
                if OPEN.fetch_add(1, Ordering::SeqCst) >= MAX_OPEN { OPEN.fetch_sub(1, Ordering::SeqCst); continue; } // dropped
                let subs = subs.clone();
                std::thread::spawn(move || { let _ = handle(s, subs); OPEN.fetch_sub(1, Ordering::SeqCst); });
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
    Ok(())
}

pub fn stop() {
    if !running() { return; }
    STOP.store(true, Ordering::SeqCst);
    let _ = TcpStream::connect(("127.0.0.1", PORT)); // wakes the accept loop so it sees STOP
    std::thread::sleep(Duration::from_millis(200));
}

/// This PC's LAN address (the one the phone should type in). No packet is sent: connect() on UDP only picks a route.
pub fn lan_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

// Who may use it from a browser: Spotify's page and the phone app (file:// sends "Origin: null"); clients without an
// Origin (scripts) too. Any other web page gets no CORS headers and no WebSocket, so a site you visit can't use the
// relay or read this PC's address.
fn origin_ok(o: Option<&str>) -> bool { matches!(o, None | Some("null" | "file://" | "https://xpui.app.spotify.com")) }
fn origin(head: &str) -> Option<String> {
    head.lines().find_map(|l| { let (k, v) = l.split_once(':')?; k.trim().eq_ignore_ascii_case("origin").then(|| v.trim().to_string()) })
}
fn cors(o: Option<&str>) -> String {
    match o {
        Some(o) if origin_ok(Some(o)) => format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Private-Network: true\r\n"),
        _ => "Vary: Origin\r\n".to_string(),
    }
}

fn valid_topic(t: &str) -> bool { !t.is_empty() && t.len() <= 64 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') }

fn handle(mut s: TcpStream, subs: Subs) -> std::io::Result<()> {
    s.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut peek = [0u8; 4096];
    let n = s.peek(&mut peek)?;
    let head = String::from_utf8_lossy(&peek[..n]).to_string();
    let mut first = head.lines().next().unwrap_or("").split(' ');
    let (method, path) = (first.next().unwrap_or(""), first.next().unwrap_or("/").split('?').next().unwrap_or("/").to_string());
    let topic = path.trim_start_matches('/').split('/').next().unwrap_or("").to_string();
    let org = origin(&head);
    if !origin_ok(org.as_deref()) { return reply(&mut s, "403 Forbidden", "", None); }

    // Subscriber: WebSocket, messages pushed as they are published, keepalive every 25s (a failed write = gone).
    if method == "GET" && path.ends_with("/ws") && valid_topic(&topic) && head.to_ascii_lowercase().contains("upgrade: websocket") {
        let mut ws = tungstenite::accept(s).map_err(|e| std::io::Error::other(e.to_string()))?;
        let (tx, rx) = channel();
        subs.lock().unwrap().entry(topic.clone()).or_default().push(tx);
        let _ = ws.send(Message::text(format!(r#"{{"event":"open","topic":"{topic}"}}"#)));
        loop {
            let m = match rx.recv_timeout(Duration::from_secs(25)) {
                Ok(m) => m,
                Err(RecvTimeoutError::Timeout) => format!(r#"{{"event":"keepalive","topic":"{topic}"}}"#),
                Err(_) => break,
            };
            if ws.send(Message::text(m)).is_err() { break; }
        }
        return Ok(());
    }

    // Plain HTTP: read the headers and (bounded) body.
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let body_at = loop {
        let k = s.read(&mut chunk)?;
        if k == 0 { return Ok(()); }
        buf.extend_from_slice(&chunk[..k]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") { break i + 4; }
        if buf.len() > 16384 { return reply(&mut s, "431 Request Header Fields Too Large", "", org.as_deref()); }
    };
    let headers = String::from_utf8_lossy(&buf[..body_at]).to_ascii_lowercase();
    let len: usize = headers.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0))).unwrap_or(0);
    if len > 65536 { return reply(&mut s, "413 Payload Too Large", "", org.as_deref()); }
    while buf.len() < body_at + len {
        let k = s.read(&mut chunk)?;
        if k == 0 { break; }
        buf.extend_from_slice(&chunk[..k]);
    }
    match method {
        "OPTIONS" => reply(&mut s, "204 No Content", "", org.as_deref()),
        "POST" | "PUT" if valid_topic(&topic) => {
            let body = String::from_utf8_lossy(&buf[body_at..(body_at + len).min(buf.len())]).to_string();
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let msg = serde_json::json!({ "id": format!("{:x}", now ^ body.len() as u64), "time": now, "event": "message", "topic": topic, "message": body }).to_string();
            if let Some(v) = subs.lock().unwrap().get_mut(&topic) { v.retain(|tx| tx.send(msg.clone()).is_ok()); }
            reply(&mut s, "200 OK", &msg, org.as_deref())
        }
        // Spotify's extension probes this to find the helper, and passes the address on to the phone.
        "GET" if path == "/" => reply(&mut s, "200 OK", &serde_json::json!({ "lyricdock": "relay", "ip": lan_ip() }).to_string(), org.as_deref()),
        _ => reply(&mut s, "404 Not Found", "", org.as_deref()),
    }
}

fn reply(s: &mut TcpStream, status: &str, body: &str, org: Option<&str>) -> std::io::Result<()> {
    write!(s, "HTTP/1.1 {status}\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", cors(org), body.len())
}
