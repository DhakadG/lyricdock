// What plays on this PC, for the LyricDock screens: Windows' media sessions (SMTC) - Apple Music, YouTube Music in a
// browser, VLC, anything that shows in the volume flyout. Spotify is left out: the extension (the bridge) has it better.
// Served next to the relay (relay.rs), on the same port and with the same Origin rules:
//   GET  /media/ws         WebSocket: {"type":"track",...} on a change, {"type":"pos",...} every second
//   GET  /media/art/<n>    the cover of the song in the last track message
//   POST /media/cmd        {"cmd":"toggle"|"next"|"prev"|"seek","ms":n}
// The page (pc.js) turns these into the same source messages as the other sources.
use std::collections::HashSet;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tungstenite::Message;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;

struct Now {
    key: String,
    track: String, // the last track message, for a screen that connects later
    art: Option<Vec<u8>>,
    stale: Option<Vec<u8>>, // the previous song's cover
    since: Instant,         // when this song was first seen
    app: String,
}
static NOW: Mutex<Option<Now>> = Mutex::new(None);
static SUBS: Mutex<Vec<Sender<String>>> = Mutex::new(Vec::new());
static STARTED: Mutex<bool> = Mutex::new(false);

// The reader runs once the first screen subscribes, then for good. Windows' own events (a session came or went, the
// current one changed, a song or play state changed - as the Taskbar Fluent Media Player mod does) wake it at once; a
// 500 ms poll is the fallback, and drives the beat every second.
fn start() {
    let mut s = STARTED.lock().unwrap();
    if *s {
        return;
    }
    *s = true;
    std::thread::spawn(|| {
        com();
        let mgr = loop {
            match Manager::RequestAsync().and_then(|a| a.join()) {
                Ok(m) => break m,
                Err(_) => std::thread::sleep(Duration::from_secs(5)),
            }
        };
        let (wake, woken) = channel::<()>();
        // (a macro: each event has its own handler type)
        macro_rules! poke {
            () => {{
                let w = wake.clone();
                TypedEventHandler::new(move |_, _| {
                    let _ = w.send(());
                    Ok(())
                })
            }};
        }
        let _ = mgr.SessionsChanged(&poke!());
        let _ = mgr.CurrentSessionChanged(&poke!());
        let mut watched: HashSet<String> = HashSet::new(); // sessions whose song / play-state events wake us
        let mut cur: Option<String> = None; // the followed session's app id
        let mut beat_at = Instant::now();
        let mut gone: Option<Instant> = None; // since when the followed session is missing
        loop {
            if let Ok(all) = mgr.GetSessions() {
                for s in all {
                    if watched.insert(app_id(&s)) {
                        let _ = s.MediaPropertiesChanged(&poke!());
                        let _ = s.PlaybackInfoChanged(&poke!());
                    }
                }
            }
            let beat = beat_at.elapsed() >= Duration::from_millis(950);
            if beat {
                beat_at = Instant::now();
            }
            // Chrome drops its session for a moment between two songs: a paused session of another app only takes over
            // once the followed one has been gone for 3 s (one that plays takes over at once).
            match pick(&mgr, cur.as_deref()) {
                Some((s, id))
                    if cur.as_ref() == Some(&id)
                        || cur.is_none()
                        || playing(&s)
                        || gone.is_some_and(|g| g.elapsed() > Duration::from_secs(3)) =>
                {
                    gone = None;
                    cur = Some(id);
                    let _ = read(&s, beat);
                }
                _ => {
                    gone.get_or_insert_with(Instant::now);
                }
            }
            if woken.recv_timeout(Duration::from_millis(500)).is_ok() {
                std::thread::sleep(Duration::from_millis(40)); // a burst of events: read once, when it settles
                while woken.try_recv().is_ok() {}
            }
        }
    });
}

fn app_id(s: &Session) -> String {
    s.SourceAppUserModelId()
        .map(|h| h.to_string())
        .unwrap_or_default()
}
fn playing(s: &Session) -> bool {
    s.GetPlaybackInfo()
        .and_then(|p| p.PlaybackStatus())
        .map(|st| st == Status::Playing)
        .unwrap_or(false)
}

// The session to follow: the one already followed while it plays, else one that plays, else the one Windows calls
// current. Two players at once don't flap.
fn pick(mgr: &Manager, cur: Option<&str>) -> Option<(Session, String)> {
    let all: Vec<Session> = mgr
        .GetSessions()
        .ok()?
        .into_iter()
        .filter(|s| !app_id(s).to_ascii_lowercase().contains("spotify"))
        .collect();
    let keep = all
        .iter()
        .find(|s| Some(app_id(s).as_str()) == cur && playing(s));
    // A player between two songs isn't "playing" for a moment: the followed session is kept while it exists, rather than
    // jumping to whatever Windows calls current (it flapped to a paused tab and back).
    let s = keep
        .or_else(|| all.iter().find(|s| playing(s)))
        .or_else(|| all.iter().find(|s| Some(app_id(s).as_str()) == cur))
        .or_else(|| {
            let c = mgr.GetCurrentSession().ok().map(|c| app_id(&c));
            all.iter().find(|s| Some(app_id(s)) == c)
        })
        .or_else(|| all.first())?
        .clone();
    let id = app_id(&s);
    Some((s, id))
}

// "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App" -> "Apple Music", "chrome.exe" -> "Chrome"
fn app_name(id: &str) -> String {
    let l = id.to_ascii_lowercase();
    for (k, n) in [
        ("applemusic", "Apple Music"),
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("vlc", "VLC"),
        ("zunemusic", "Media Player"),
        ("youtube", "YouTube Music"),
        ("tidal", "TIDAL"),
        ("deezer", "Deezer"),
        ("foobar", "foobar2000"),
        ("musicbee", "MusicBee"),
    ] {
        if l.contains(k) {
            return n.to_string();
        }
    }
    let base = id.rsplit(['\\', '!']).next().unwrap_or(id);
    base.trim_end_matches(".exe").to_string()
}

const UNIX_IN_FILETIME: i64 = 116_444_736_000_000_000; // 1601 -> 1970 in 100 ns ticks
fn now_ticks() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as i64 / 100)
        .unwrap_or(0)
        + UNIX_IN_FILETIME
}

fn read(s: &Session, beat: bool) -> windows::core::Result<()> {
    let p = s.TryGetMediaPropertiesAsync()?.join()?;
    let (title, artist, album) = (
        p.Title()?.to_string(),
        p.Artist()?.to_string(),
        p.AlbumTitle()?.to_string(),
    );
    if title.trim().is_empty() {
        return Ok(());
    }
    let t = s.GetTimelineProperties()?;
    let dur = (t.EndTime()?.Duration - t.StartTime()?.Duration) / 10_000;
    let play = playing(s);
    let mut pos = t.Position()?.Duration / 10_000;
    let upd = t.LastUpdatedTime()?.UniversalTime;
    if play && upd > 0 {
        pos += (now_ticks() - upd).max(0) / 10_000;
    }
    let id = app_id(s);
    let key = format!("{id}\n{title}\n{artist}");
    let mut sent = None;
    {
        let mut now = NOW.lock().unwrap();
        let fresh = now.as_ref().map(|n| n.key != key).unwrap_or(true);
        let need_art = fresh || now.as_ref().map(|n| n.art.is_none()).unwrap_or(true);
        // A player names the song a moment before its cover (and its length): the same song again, now with them.
        // Browsers hand over the previous song's cover first: one identical to it waits for the real one - for 3 s, since
        // the next song from the same album really has the same cover.
        let stale = now.as_ref().and_then(|n| {
            if fresh {
                n.art.clone()
            } else if n.since.elapsed() < Duration::from_secs(3) {
                n.stale.clone()
            } else {
                None
            }
        });
        let art = if need_art {
            cover(&p).filter(|b| Some(b) != stale.as_ref())
        } else {
            None
        };
        if fresh
            || art.is_some()
            || now
                .as_ref()
                .map(|n| n.track.contains("\"dur\":0") && dur > 0)
                .unwrap_or(false)
        {
            let n = now.get_or_insert_with(|| Now {
                key: String::new(),
                track: String::new(),
                art: None,
                stale: None,
                since: Instant::now(),
                app: String::new(),
            });
            if fresh {
                n.stale = n.art.take();
                n.since = Instant::now();
            }
            if art.is_some() {
                n.art = art;
            }
            n.key = key.clone();
            n.app = app_name(&id);
            let a1 = artist
                .split([',', '&', '、', '/'])
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            n.track = serde_json::json!({
                "type": "track",
                "id": format!("pc{:x}", hash(&key)),
                "title": title, "artist": artist, "a1": a1, "album": album,
                "dur": dur.max(0),
                // named by its content: a new cover is a new address for the screens' image caches, across helper
                // restarts too (a per-run number showed an old song's cover)
                "art": n.art.as_ref().map(|b| format!("/media/art/{:x}", hash_bytes(b))),
                "app": id, "appName": n.app,
            })
            .to_string();
            sent = Some(n.track.clone());
        }
    }
    // A beat every second, and at once after a song change or a play / pause (not on the next second).
    let flipped = LAST_PLAY.lock().unwrap().replace(play) != Some(play);
    let song = sent.is_some();
    if let Some(m) = sent {
        publish(m);
    }
    if beat || song || flipped {
        publish(serde_json::json!({ "type": "pos", "pos": pos.max(0), "playing": play, "dur": dur.max(0) }).to_string());
    }
    Ok(())
}
static LAST_PLAY: Mutex<Option<bool>> = Mutex::new(None);

fn com() {
    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        );
    }
}

fn hash(s: &str) -> u64 {
    hash_bytes(s.as_bytes())
}
fn hash_bytes(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf29ce484222325u64, |h, &b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    })
}

fn cover(
    p: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<Vec<u8>> {
    let st = p.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = st.Size().ok()? as u32;
    if size == 0 || size > 8 << 20 {
        return None;
    }
    let r = DataReader::CreateDataReader(&st.GetInputStreamAt(0).ok()?).ok()?;
    r.LoadAsync(size).ok()?.join().ok()?;
    let mut b = vec![0u8; size as usize];
    r.ReadBytes(&mut b).ok()?;
    Some(b)
}

fn publish(m: String) {
    SUBS.lock().unwrap().retain(|tx| tx.send(m.clone()).is_ok());
}

// ---- the relay hands these over (relay.rs handle)
pub fn ws(s: std::net::TcpStream) -> std::io::Result<()> {
    start();
    let mut ws = tungstenite::accept(s).map_err(|e| std::io::Error::other(e.to_string()))?;
    let (tx, rx) = channel();
    if let Some(n) = NOW.lock().unwrap().as_ref() {
        let _ = tx.send(n.track.clone()); // the song already playing
    }
    SUBS.lock().unwrap().push(tx);
    loop {
        let m = match rx.recv_timeout(Duration::from_secs(25)) {
            Ok(m) => m,
            Err(RecvTimeoutError::Timeout) => r#"{"type":"keepalive"}"#.to_string(),
            Err(_) => break,
        };
        if ws.send(Message::text(m)).is_err() {
            break;
        }
    }
    Ok(())
}

pub fn art() -> Option<(Vec<u8>, &'static str)> {
    let b = NOW.lock().unwrap().as_ref()?.art.clone()?;
    let ty = if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        "image/jpeg"
    };
    Some((b, ty))
}

pub fn cmd(body: &str) {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let c = v["cmd"].as_str().unwrap_or("").to_string();
    let ms = v["ms"].as_f64().unwrap_or(0.0);
    std::thread::spawn(move || {
        com();
        let _ = (|| -> windows::core::Result<()> {
            let mgr = Manager::RequestAsync()?.join()?;
            let cur = NOW
                .lock()
                .unwrap()
                .as_ref()
                .map(|n| n.key.split('\n').next().unwrap_or("").to_string());
            let s = match pick(&mgr, cur.as_deref()) {
                Some((s, _)) => s,
                None => return Ok(()),
            };
            match c.as_str() {
                "toggle" => drop(s.TryTogglePlayPauseAsync()?.join()?),
                "next" => drop(s.TrySkipNextAsync()?.join()?),
                "prev" => drop(s.TrySkipPreviousAsync()?.join()?),
                "seek" => drop(
                    s.TryChangePlaybackPositionAsync((ms.max(0.0) as i64) * 10_000)?
                        .join()?,
                ),
                _ => {}
            }
            Ok(())
        })();
    });
}
