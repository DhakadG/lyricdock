// LyricDock Helper: a small Windows companion (tray + window) for the Spotify side of LyricDock.
// Everyday use needs none of it - Spotify and the phone connect directly. It shows whether the extension is
// installed, repairs / updates it, runs the one-time phone setup, and (developer page) drives the adb link.
// Same UI stack as Ethernet Guardian: Tauri 2 + plain HTML/CSS/JS in ../src.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod relay;

use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

const NO_WINDOW: u32 = 0x0800_0000;
// The installer scripts this helper runs come from its own release tag, not from `main`: a push to `main` alone can't
// change what a released helper executes (tags are made by scripts/release.ps1 together with this version).
const REPO_RAW: &str = concat!("https://raw.githubusercontent.com/DhakadG/lyricdock/v", env!("CARGO_PKG_VERSION"));
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const LINK_PS1: &str = include_str!("../../../scripts/link.ps1");
const FIND_ADB_PS1: &str = include_str!("../../../scripts/find-adb.ps1");

fn hidden(cmd: &str, args: &[&str]) -> Option<std::process::Output> {
    Command::new(cmd).args(args).creation_flags(NO_WINDOW).output().ok()
}
fn ps(script: &str) -> String {
    hidden("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", script])
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}
fn local_dir() -> PathBuf {
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("LyricDock")
}

#[derive(Serialize)]
struct Status {
    spicetify: Option<String>,
    extensions_dir: Option<String>,
    loader_installed: bool,
    dev_copy: bool,
    enabled: bool,
    autostart: bool,
    adb: Option<String>,
    link_running: bool,
    version: String,
}

fn spicetify_path() -> Option<String> {
    let found = ps("(Get-Command spicetify -ErrorAction SilentlyContinue).Source");
    if !found.is_empty() {
        return Some(found);
    }
    let p = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("spicetify").join("spicetify.exe");
    p.exists().then(|| p.display().to_string())
}

// Cached: finding adb runs PowerShell (slow); it doesn't move while the helper runs. Re-looked-up if it vanished.
static ADB: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
fn adb_path() -> Option<String> {
    if let Some(p) = ADB.lock().unwrap().clone() { if std::path::Path::new(&p).exists() { return Some(p); } }
    let found = find_adb();
    *ADB.lock().unwrap() = found.clone();
    found
}
fn find_adb() -> Option<String> {
    let dir = local_dir().join("helper");
    let _ = std::fs::create_dir_all(&dir);
    let f = dir.join("find-adb.ps1");
    let _ = std::fs::write(&f, FIND_ADB_PS1);
    let out = ps(&format!("try {{ & '{}' }} catch {{ '' }}", f.display()));
    (!out.is_empty()).then_some(out)
}

fn link_running() -> bool {
    ps("[bool](Get-CimInstance Win32_Process -Filter \"Name like 'p%sh%.exe'\" | Where-Object { $_.CommandLine -like '*link.ps1*' })") == "True"
}

// Every command that shells out is async: Tauri runs plain fn commands on the UI thread, which froze the window
// (the live phone screen ran adb every 2 seconds).
#[tauri::command]
async fn status(app: AppHandle) -> Status {
    let spicetify = spicetify_path();
    let config = spicetify.as_ref().map(|s| ps(&format!("& '{s}' -c"))).unwrap_or_default();
    let extensions_dir = (!config.is_empty()).then(|| PathBuf::from(&config).parent().map(|p| p.join("Extensions")).unwrap_or_default());
    let has = |name: &str| extensions_dir.as_ref().map(|d| d.join(name).exists()).unwrap_or(false);
    let enabled = std::fs::read_to_string(&config).map(|c| c.lines().any(|l| l.starts_with("extensions") && l.contains("lyricdock.js"))).unwrap_or(false);
    let autostart = hidden("reg.exe", &["query", RUN_KEY, "/v", "LyricDockHelper"]).map(|o| o.status.success()).unwrap_or(false);
    let (loader_installed, dev_copy) = (has("lyricdock.js"), has("dock-bridge.js"));
    Status {
        extensions_dir: extensions_dir.map(|d| d.display().to_string()),
        loader_installed,
        dev_copy,
        enabled,
        autostart,
        adb: adb_path(),
        link_running: link_running(),
        version: app.package_info().version.to_string(),
        spicetify,
    }
}

/// Opens a visible PowerShell window running one of the repo's scripts (so the user sees every step).
fn console(script_url: &str) -> Result<(), String> {
    // `start "title" program ...`: the title must be quoted or start treats it as the program ("cannot find
    // 'LyricDock'"). raw_arg keeps Rust from re-quoting the line.
    Command::new("cmd.exe")
        .raw_arg(format!("/c start \"LyricDock\" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -Command \"iwr -useb {script_url} | iex\""))
        .creation_flags(NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn install_extension() -> Result<(), String> { console(&format!("{REPO_RAW}/updater/install.ps1")) }
#[tauri::command]
async fn setup_phone() -> Result<(), String> { console(&format!("{REPO_RAW}/updater/setup-phone.ps1")) }

#[tauri::command]
async fn set_autostart(on: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let ok = if on {
        hidden("reg.exe", &["add", RUN_KEY, "/v", "LyricDockHelper", "/t", "REG_SZ", "/d", &format!("\"{}\" --tray", exe.display()), "/f"])
    } else {
        hidden("reg.exe", &["delete", RUN_KEY, "/v", "LyricDockHelper", "/f"])
    };
    ok.filter(|o| o.status.success()).map(|_| ()).ok_or_else(|| "Could not change the Windows startup entry".into())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("spotify:")) {
        return Err("blocked".into());
    }
    Command::new("explorer.exe").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---- developer page (adb): the link script, phone controls and a screenshot
#[tauri::command]
async fn link(start: bool) -> Result<bool, String> {
    if start {
        let dir = local_dir().join("helper");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("find-adb.ps1"), FIND_ADB_PS1).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("link.ps1"), LINK_PS1).map_err(|e| e.to_string())?;
        Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", &dir.join("link.ps1").display().to_string()])
            .creation_flags(NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        ps("Get-CimInstance Win32_Process -Filter \"Name like 'p%sh%.exe'\" | Where-Object { $_.CommandLine -like '*link.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }");
    }
    std::thread::sleep(std::time::Duration::from_millis(600));
    Ok(link_running())
}

#[tauri::command]
async fn phone(action: String) -> Result<String, String> {
    let adb = adb_path().ok_or("adb not found")?;
    let pkg = "com.you.lyricdock";
    let run = |args: &[&str]| hidden(&adb, args).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    Ok(match action.as_str() {
        "devices" => run(&["devices", "-l"]),
        "restart" => { run(&["shell", "am", "force-stop", pkg]); run(&["shell", "am", "start", "-n", &format!("{pkg}/.MainActivity")]) }
        "screen" => { let o = hidden(&adb, &["exec-out", "screencap", "-p"]).ok_or("screencap failed")?; b64(&o.stdout) }
        "version" => run(&["shell", "dumpsys", "package", pkg]).lines().find(|l| l.contains("versionName=")).unwrap_or("").trim().replace("versionName=", ""),
        _ => return Err("unknown action".into()),
    })
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len() * 4 / 3 + 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            s.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    s
}

// ---- local signalling relay (relay.rs). The on/off choice survives restarts (a flag file).
#[derive(Serialize)]
struct RelayInfo { running: bool, ip: Option<String>, port: u16 }
fn relay_flag() -> PathBuf { local_dir().join("helper").join("relay.on") }
#[tauri::command]
async fn relay_status() -> RelayInfo { RelayInfo { running: relay::running(), ip: relay::lan_ip(), port: relay::PORT } }
#[tauri::command]
async fn relay_set(on: bool) -> Result<RelayInfo, String> {
    let _ = std::fs::create_dir_all(local_dir().join("helper"));
    if on { relay::start()?; let _ = std::fs::write(relay_flag(), "1"); } else { relay::stop(); let _ = std::fs::remove_file(relay_flag()); }
    Ok(RelayInfo { running: relay::running(), ip: relay::lan_ip(), port: relay::PORT })
}

#[tauri::command]
fn quit(app: AppHandle) { app.exit(0); }

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    let tray_only = std::env::args().any(|a| a == "--tray");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            if relay_flag().exists() { let _ = relay::start(); }
            let open = MenuItem::with_id(app, "open", "Open LyricDock Helper", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit_i])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("LyricDock Helper")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() { "open" => show(app), "quit" => app.exit(0), _ => {} })
                .on_tray_icon_event(|t, e| if let TrayIconEvent::Click { button: MouseButton::Left, .. } = e { show(t.app_handle()) })
                .build(app)?;
            if let Some(w) = app.get_webview_window("main") {
                if !tray_only { let _ = w.show(); }
                let wh = w.clone();
                w.on_window_event(move |ev| if let WindowEvent::CloseRequested { api, .. } = ev { api.prevent_close(); let _ = wh.hide(); });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![status, install_extension, setup_phone, set_autostart, open_url, link, phone, relay_status, relay_set, quit])
        .build(tauri::generate_context!())
        .expect("error while building LyricDock Helper")
        .run(|_app, event| {
            // Closing the window keeps it in the tray; only Quit ends it.
            if let RunEvent::ExitRequested { code: None, api, .. } = event { api.prevent_exit(); }
        });
}
